const assert = require("node:assert");
const { describe, it } = require("node:test");

const RoborockV1MapSegmentationCapability = require("../../../../lib/robots/roborock/capabilities/RoborockV1MapSegmentationCapability");
const RoborockV1MapSegmentRenameCapability = require("../../../../lib/robots/roborock/capabilities/RoborockV1MapSegmentRenameCapability");

/**
 * Creates a fake robot with a recording sendCommand stub and a plain mapStore stub.
 * It deliberately does not use RoborockV1MapStore (or the real robot) so that the test
 * only exercises the capability logic.
 *
 * @param {object} [options]
 * @param {Array<object>} [options.rooms]
 * @returns {object}
 */
function createFakeRobot(options = {}) {
    const rooms = new Map((options.rooms ?? []).map(room => [String(room.id), room]));

    const fakeRobot = {
        sentCommands: [],
        pollMapCalls: 0,
        upsertedRooms: [],
        renamedRooms: [],
        mapStore: {
            getRoom: id => rooms.get(String(id)),
            listRooms: () => Array.from(rooms.values()),
            upsertRoom: (rect, name) => {
                fakeRobot.upsertedRooms.push({rect: rect, name: name});

                const room = {id: String(rooms.size + 1), name: name, rect: rect};
                rooms.set(room.id, room);

                return room;
            },
            renameRoom: (id, name) => {
                fakeRobot.renamedRooms.push({id: id, name: name});
            }
        },
        sendCommand: (method, params) => {
            fakeRobot.sentCommands.push({method: method, params: params});

            return Promise.resolve();
        },
        pollMap: () => {
            fakeRobot.pollMapCalls++;
        }
    };

    return fakeRobot;
}

/**
 * Runs fn while recording timer delays and firing the callbacks immediately, so that the
 * inter-batch delay does not slow the test down.
 *
 * @param {Function} fn
 * @returns {Promise<Array<number>>} the recorded delay values
 */
async function withInstantTimers(fn) {
    const originalSetTimeout = global.setTimeout;
    const delays = [];

    global.setTimeout = (callback, delay) => {
        delays.push(delay);
        callback();

        return 0;
    };

    try {
        await fn();
    } finally {
        global.setTimeout = originalSetTimeout;
    }

    return delays;
}

/**
 * @param {object} robot
 * @returns {RoborockV1MapSegmentationCapability}
 */
function createSegmentationCapability(robot) {
    return new RoborockV1MapSegmentationCapability({robot: robot});
}

const ROOM_ONE = {
    id: "1",
    name: "One",
    rect: {x1: 100, y1: 100, x2: 150, y2: 200}
};

describe("RoborockV1MapSegmentationCapability", () => {
    describe("ROOM_TO_ZONE", () => {
        it("converts a room rectangle to the app_zoned_clean tuple (mm, y-flipped)", () => {
            assert.deepStrictEqual(
                RoborockV1MapSegmentationCapability.ROOM_TO_ZONE({x1: 2500, y1: 2500, x2: 3500, y2: 3000}, 2),
                [25000, 21200, 35000, 26200, 2]
            );
        });

        it("normalises swapped corners so x1<x2 and y1<y2", () => {
            assert.deepStrictEqual(
                RoborockV1MapSegmentationCapability.ROOM_TO_ZONE({x1: 3500, y1: 3000, x2: 2500, y2: 2500}, 1),
                [25000, 21200, 35000, 26200, 1]
            );
        });

        it("floors exactly like RoborockZoneCleaningCapability does", () => {
            // DIMENSION_MM is 51200; 51200 - 200.25 * 10 = 49197.5 which floors to 49197
            assert.deepStrictEqual(
                RoborockV1MapSegmentationCapability.ROOM_TO_ZONE({x1: 100.5, y1: 200.25, x2: 300.75, y2: 400.5}, 1),
                [1005, 47195, 3007, 49197, 1]
            );
        });
    });

    describe("executeSegmentAction", () => {
        it("chunks 6 rooms into batches of 5 and waits only between batches", async () => {
            const rooms = [];
            for (let i = 1; i <= 6; i++) {
                rooms.push({
                    id: String(i),
                    name: "Room " + i,
                    rect: {x1: 100 * i, y1: 100, x2: 100 * i + 50, y2: 200}
                });
            }
            const robot = createFakeRobot({rooms: rooms});
            const capability = createSegmentationCapability(robot);

            const delays = await withInstantTimers(() => {
                return capability.executeSegmentAction(
                    rooms.map(room => {
                        return {id: room.id};
                    }),
                    {iterations: 1}
                );
            });

            assert.strictEqual(robot.sentCommands.length, 2);

            const firstCommand = robot.sentCommands[0];
            const secondCommand = robot.sentCommands[1];

            assert.strictEqual(firstCommand.method, "app_zoned_clean");
            assert.strictEqual(firstCommand.params.length, 5);
            assert.deepStrictEqual(firstCommand.params[0], [1000, 49200, 1500, 50200, 1]);

            assert.strictEqual(secondCommand.method, "app_zoned_clean");
            assert.strictEqual(secondCommand.params.length, 1);
            assert.deepStrictEqual(secondCommand.params[0], [6000, 49200, 6500, 50200, 1]);

            robot.sentCommands.forEach(command => {
                command.params.forEach(zone => {
                    assert.strictEqual(Array.isArray(zone), true);
                    assert.strictEqual(zone.length, 5);
                });
            });

            // Exactly one 5 s delay between the two batches and none after the final one
            assert.deepStrictEqual(delays, [5000]);
        });

        it("clamps iterations to the firmware-supported 1..3 range", async () => {
            const cases = [
                {input: undefined, expected: 1},
                {input: 0, expected: 1},
                {input: 99, expected: 3},
                {input: 2, expected: 2}
            ];

            for (const testCase of cases) {
                const robot = createFakeRobot({rooms: [ROOM_ONE]});
                const capability = createSegmentationCapability(robot);

                await capability.executeSegmentAction(
                    [{id: "1"}],
                    testCase.input === undefined ? undefined : {iterations: testCase.input}
                );

                assert.strictEqual(robot.sentCommands.length, 1);
                assert.strictEqual(robot.sentCommands[0].params[0][4], testCase.expected);
            }
        });

        it("sends nothing when no segment id resolves to a stored room", async () => {
            const robot = createFakeRobot({rooms: [ROOM_ONE]});
            const capability = createSegmentationCapability(robot);

            await capability.executeSegmentAction([{id: "42"}, {id: "43"}], {iterations: 1});

            assert.strictEqual(robot.sentCommands.length, 0);
        });

        it("skips unknown ids but still cleans the known ones", async () => {
            const robot = createFakeRobot({rooms: [ROOM_ONE]});
            const capability = createSegmentationCapability(robot);

            await capability.executeSegmentAction([{id: "42"}, {id: "1"}], {iterations: 1});

            assert.strictEqual(robot.sentCommands.length, 1);
            assert.strictEqual(robot.sentCommands[0].params.length, 1);
            assert.deepStrictEqual(robot.sentCommands[0].params[0], [1000, 49200, 1500, 50200, 1]);
        });
    });

    describe("getProperties", () => {
        it("advertises 1..3 iterations, no custom order and segment creation support", () => {
            const capability = createSegmentationCapability(createFakeRobot());

            assert.deepStrictEqual(capability.getProperties(), {
                iterationCount: {
                    min: 1,
                    max: 3
                },
                customOrderSupport: false,
                segmentCreationSupport: true
            });
        });
    });

    describe("name validation", () => {
        it("rejects a 24 character name in createSegment without touching the store", async () => {
            const robot = createFakeRobot({rooms: [ROOM_ONE]});
            const capability = createSegmentationCapability(robot);

            await assert.rejects(
                () => capability.createSegment({x1: 100, y1: 100, x2: 150, y2: 200}, "x".repeat(24)),
                /Invalid name/
            );
            await assert.rejects(
                () => capability.createSegment({x1: 100, y1: 100, x2: 150, y2: 200}, ""),
                /Invalid name/
            );

            assert.deepStrictEqual(robot.upsertedRooms, []);
            assert.strictEqual(robot.pollMapCalls, 0);
        });

        it("creates a room with a valid name and triggers a map poll", async () => {
            const robot = createFakeRobot();
            const capability = createSegmentationCapability(robot);

            const room = await capability.createSegment({x1: 100, y1: 100, x2: 150, y2: 200}, "Kitchen");

            assert.deepStrictEqual(robot.upsertedRooms, [{
                rect: {x1: 100, y1: 100, x2: 150, y2: 200},
                name: "Kitchen"
            }]);
            assert.strictEqual(robot.pollMapCalls, 1);
            assert.strictEqual(room.name, "Kitchen");
        });

        it("rejects a 24 character name in renameSegment without touching the store", async () => {
            const robot = createFakeRobot({rooms: [ROOM_ONE]});
            const capability = new RoborockV1MapSegmentRenameCapability({robot: robot});

            await assert.rejects(() => capability.renameSegment({id: "1"}, "x".repeat(24)), /Invalid name/);

            assert.deepStrictEqual(robot.renamedRooms, []);
            assert.strictEqual(robot.pollMapCalls, 0);
        });

        it("renames a room through the store and triggers a map poll", async () => {
            const robot = createFakeRobot({rooms: [ROOM_ONE]});
            const capability = new RoborockV1MapSegmentRenameCapability({robot: robot});

            await capability.renameSegment({id: "1"}, "Kitchen");

            assert.deepStrictEqual(robot.renamedRooms, [{id: "1", name: "Kitchen"}]);
            assert.strictEqual(robot.pollMapCalls, 1);
        });

        it("does not send get_room_mapping when fetching segment names", async () => {
            const robot = createFakeRobot({rooms: [ROOM_ONE]});
            const capability = new RoborockV1MapSegmentRenameCapability({robot: robot});

            await capability.fetchAndStoreSegmentNames();

            assert.deepStrictEqual(robot.sentCommands, []);
        });
    });
});
