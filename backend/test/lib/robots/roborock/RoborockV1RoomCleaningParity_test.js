const assert = require("node:assert");
const { describe, it } = require("node:test");

const ITERATIONS = 3;

const RoborockV1MapSegmentationCapability = require("../../../../lib/robots/roborock/capabilities/RoborockV1MapSegmentationCapability");
const RoborockZoneCleaningCapability = require("../../../../lib/robots/roborock/capabilities/RoborockZoneCleaningCapability");
const ValetudoMapSegment = require("../../../../lib/entities/core/ValetudoMapSegment");
const ValetudoZone = require("../../../../lib/entities/core/ValetudoZone");

/**
 * Builds a robot stub which records every sendCommand call.
 *
 * @param {object} [extra]
 * @returns {{sentCommands: Array<object>, robot: object}}
 */
function createRecordingRobot(extra = {}) {
    const sentCommands = [];

    return {
        sentCommands: sentCommands,
        robot: Object.assign({
            sendCommand: (method, params) => {
                sentCommands.push({method: method, params: params});

                return Promise.resolve();
            }
        }, extra)
    };
}

/**
 * @param {{x1: number, y1: number, x2: number, y2: number}} rect
 * @returns {ValetudoZone}
 */
function zoneFromRect(rect) {
    return new ValetudoZone({
        points: {
            pA: {x: rect.x1, y: rect.y1},
            pB: {x: rect.x2, y: rect.y1},
            pC: {x: rect.x2, y: rect.y2},
            pD: {x: rect.x1, y: rect.y2}
        }
    });
}

const RECTS = [
    {x1: 2500, y1: 2500, x2: 3500, y2: 3000},
    {x1: 100.5, y1: 200.25, x2: 300.75, y2: 400.5},
    {x1: 0, y1: 0, x2: 5120, y2: 5120},
    {x1: 1234, y1: 4321, x2: 4999, y2: 5000}
];

describe("RoborockV1 room cleaning", () => {
    describe("parity with RoborockZoneCleaningCapability", () => {
        RECTS.forEach(rect => {
            it(`sends the exact same app_zoned_clean payload as zone cleaning for ${JSON.stringify(rect)}`, async () => {
                const zoneClean = createRecordingRobot();
                await new RoborockZoneCleaningCapability({robot: zoneClean.robot}).start({
                    zones: [zoneFromRect(rect)],
                    iterations: ITERATIONS
                });

                const roomClean = createRecordingRobot({
                    mapStore: {
                        getRoom: () => {
                            return {id: "1", name: "room", rect: rect};
                        }
                    },
                    pollMap: () => {}
                });
                await new RoborockV1MapSegmentationCapability({robot: roomClean.robot}).executeSegmentAction(
                    [new ValetudoMapSegment({id: "1"})],
                    {iterations: ITERATIONS}
                );

                assert.strictEqual(zoneClean.sentCommands.length, 1);
                assert.strictEqual(roomClean.sentCommands.length, 1);

                assert.strictEqual(roomClean.sentCommands[0].method, zoneClean.sentCommands[0].method);
                assert.deepStrictEqual(roomClean.sentCommands[0].params, zoneClean.sentCommands[0].params);
                assert.deepStrictEqual(
                    roomClean.sentCommands[0].params,
                    [RoborockV1MapSegmentationCapability.ROOM_TO_ZONE(rect, ITERATIONS)]
                );
            });
        });
    });
});
