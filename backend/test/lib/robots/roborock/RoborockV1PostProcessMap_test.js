const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const capabilities = require("../../../../lib/robots/roborock/capabilities");
const Logger = require("../../../../lib/Logger");
const MapLayer = require("../../../../lib/entities/map/MapLayer");
const PointMapEntity = require("../../../../lib/entities/map/entities/PointMapEntity");
const RoborockV1MapStore = require("../../../../lib/robots/roborock/RoborockV1MapStore");
const RoborockV1ValetudoRobot = require("../../../../lib/robots/roborock/RoborockV1ValetudoRobot");
const ValetudoMap = require("../../../../lib/entities/map/ValetudoMap");
const ValetudoMapSegment = require("../../../../lib/entities/core/ValetudoMapSegment");
const ValetudoRestrictedZone = require("../../../../lib/entities/core/ValetudoRestrictedZone");
const ValetudoVirtualRestrictions = require("../../../../lib/entities/core/ValetudoVirtualRestrictions");
const ValetudoVirtualWall = require("../../../../lib/entities/core/ValetudoVirtualWall");

const CHARGER_POINT = [2560, 2560];
const ROOM_RECT = {x1: 2500, y1: 2500, x2: 3500, y2: 3000};

/**
 * Builds a Gen 1 like ValetudoMap (5120 cm, 5 cm pixels, floor + wall layer, charger).
 *
 * @param {object} [options]
 * @param {boolean} [options.defaultMap]
 * @param {boolean} [options.withFloorLayer]
 * @returns {ValetudoMap}
 */
function buildMap(options = {}) {
    const layers = [];

    if (options.withFloorLayer !== false) {
        layers.push(new MapLayer({
            type: MapLayer.TYPE.FLOOR,
            pixels: [500, 500, 501, 500, 502, 500, 503, 500]
        }));
    }

    layers.push(new MapLayer({
        type: MapLayer.TYPE.WALL,
        pixels: [504, 504]
    }));

    const chargerPoint = options.chargerPoint ?? CHARGER_POINT;

    return new ValetudoMap({
        size: {x: 5120, y: 5120},
        pixelSize: 5,
        layers: layers,
        entities: [
            new PointMapEntity({
                type: PointMapEntity.TYPE.CHARGER_LOCATION,
                points: chargerPoint
            })
        ],
        metaData: options.defaultMap === true ? {defaultMap: true} : {}
    });
}

/**
 * Adds the real overlay methods of the Gen 1 robot to a plain robot double, so that the tests
 * exercise the actual behaviour instead of a stub.
 *
 * @param {object} robot
 * @returns {object}
 */
function withOverlay(robot) {
    for (const method of ["applyMapStoreOverlay", "postProcessMap", "refreshMapStoreOverlay", "restoreLastKnownMap"]) {
        robot[method] = RoborockV1ValetudoRobot.prototype[method];
    }

    return robot;
}

/**
 * @param {object} options
 * @param {RoborockV1MapStore} options.store
 * @param {ValetudoMap} [options.map]
 * @param {Function} [options.sendCommand]
 * @returns {object}
 */
function buildRobot(options) {
    const robot = withOverlay({
        mapStore: options.store,
        state: {map: options.map ?? buildMap()},
        mapUpdatedEvents: 0,
        sendCommand: options.sendCommand ?? (() => Promise.resolve())
    });

    robot.emitMapUpdated = () => {
        robot.mapUpdatedEvents++;
    };

    return robot;
}

describe("RoborockV1 map pipeline", () => {
    let dir;
    let store;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "valetudo-v1-pipeline-"));
        store = new RoborockV1MapStore({filePath: path.join(dir, "mapstore.json")});
    });

    afterEach(() => {
        fs.rmSync(dir, {recursive: true, force: true});
    });

    describe("postProcessMap", () => {
        it("overlays the stored rooms and restrictions onto a freshly parsed map", () => {
            const room = store.upsertRoom(ROOM_RECT, "Kitchen");

            store.setRestrictions(new ValetudoVirtualRestrictions({
                virtualWalls: [
                    new ValetudoVirtualWall({points: {pA: {x: 2500, y: 2500}, pB: {x: 3000, y: 2500}}})
                ],
                restrictedZones: [
                    new ValetudoRestrictedZone({
                        type: ValetudoRestrictedZone.TYPE.REGULAR,
                        points: {
                            pA: {x: 2500, y: 2500},
                            pB: {x: 3000, y: 2500},
                            pC: {x: 3000, y: 3000},
                            pD: {x: 2500, y: 3000}
                        }
                    })
                ]
            }));

            const map = buildMap();
            const robot = withOverlay({mapStore: store, state: {map: map}});

            const result = robot.postProcessMap(map);

            assert.strictEqual(result, map, "postProcessMap mutates and returns the given map");

            assert.deepStrictEqual(
                map.getSegments().map(segment => {
                    return {id: segment.id, name: segment.name};
                }),
                [{id: room.id, name: "Kitchen"}]
            );

            const segmentLayer = map.layers.find(layer => {
                return layer.type === MapLayer.TYPE.SEGMENT;
            });
            const segmentPixels = MapLayer.DECOMPRESS_PIXELS(segmentLayer.compressedPixels);

            assert.deepStrictEqual(
                segmentPixels,
                RoborockV1MapStore.rectToPixels(ROOM_RECT, 5),
                "the room pixels round trip through the layer RLE compression"
            );

            assert.strictEqual(store.getFloorKey(), "charger:2560,2560", "the charger anchor is recorded");

            return new capabilities.RoborockV1CombinedVirtualRestrictionsCapability({robot: robot})
                .getVirtualRestrictions()
                .then(restrictions => {
                    assert.strictEqual(restrictions.virtualWalls.length, 1);
                    assert.strictEqual(restrictions.restrictedZones.length, 1);
                    assert.deepStrictEqual(restrictions.restrictedZones[0].type, ValetudoRestrictedZone.TYPE.REGULAR);
                });
        });

        it("is idempotent across repeated map polls", () => {
            store.upsertRoom(ROOM_RECT, "Kitchen");

            const map = buildMap();
            const robot = withOverlay({mapStore: store});

            robot.postProcessMap(map);
            robot.postProcessMap(map);
            robot.postProcessMap(map);

            assert.strictEqual(map.layers.filter(layer => layer.type === MapLayer.TYPE.SEGMENT).length, 1);
            assert.strictEqual(map.getSegments().length, 1);
        });

        it("does not touch the map when Valetudo-side persistence is disabled", () => {
            store.upsertRoom(ROOM_RECT, "Kitchen");
            store.setPersistentMapEnabled(false);

            const map = buildMap();
            withOverlay({mapStore: store}).postProcessMap(map);

            assert.strictEqual(map.getSegments().length, 0);
            assert.strictEqual(store.getFloorKey(), undefined);
        });

        it("does not overlay the default (empty) map", () => {
            store.upsertRoom(ROOM_RECT, "Kitchen");

            const map = buildMap({defaultMap: true});
            withOverlay({mapStore: store}).postProcessMap(map);

            assert.strictEqual(map.getSegments().length, 0);
        });

        it("absorbs the charger jitter and warns only once per observed anchor", () => {
            store.setFloorKey("charger:2560,2532");

            assert.strictEqual(RoborockV1MapStore.floorKeysMatch("charger:2560,2532", "charger:2565,2533"), true);
            assert.strictEqual(RoborockV1MapStore.floorKeysMatch("charger:2560,2532", "charger:3500,3500"), false);
            assert.strictEqual(RoborockV1MapStore.floorKeysMatch(undefined, "charger:1,1"), false);
            assert.strictEqual(RoborockV1MapStore.floorKeysMatch("nonsense", "charger:1,1"), false);

            const warnings = [];
            const originalWarn = Logger.warn;
            Logger.warn = message => {
                warnings.push(message);
            };

            try {
                const robot = withOverlay({mapStore: store});

                robot.postProcessMap(buildMap({chargerPoint: [2565, 2533]}));
                assert.deepStrictEqual(warnings, [], "a one pixel charger jitter must not warn");

                const movedMap = buildMap({chargerPoint: [3500, 3500]});
                robot.postProcessMap(movedMap);
                robot.postProcessMap(movedMap);
                robot.postProcessMap(movedMap);

                assert.strictEqual(warnings.length, 1, "warn once per observed anchor, not on every map poll");
                assert.match(warnings[0], /charger anchor moved/);
                assert.match(warnings[0], /observed charger:3500,3500/);
                assert.strictEqual(store.getFloorKey(), "charger:2560,2532", "the stored anchor and the rooms are kept");
            } finally {
                Logger.warn = originalWarn;
            }
        });

        it("does not overlay a map which has no floor layer", () => {
            store.upsertRoom(ROOM_RECT, "Kitchen");

            const map = buildMap({withFloorLayer: false});
            withOverlay({mapStore: store}).postProcessMap(map);

            assert.strictEqual(map.getSegments().length, 0);
        });
    });

    describe("map state while docked and across restarts", () => {
        it("remembers the map which was parsed last", () => {
            store.upsertRoom(ROOM_RECT, "Kitchen");

            buildRobot({store: store}).postProcessMap(buildMap());

            const remembered = store.getLastMap();

            assert.ok(remembered, "the parsed map is remembered");

            const restored = ValetudoMap.DESERIALIZE(JSON.parse(remembered.map));

            assert.deepStrictEqual(restored.getSegments().map(s => s.name), ["Kitchen"]);
        });

        it("does not remember a map while Valetudo-side persistence is off", () => {
            store.setPersistentMapEnabled(false);

            buildRobot({store: store}).postProcessMap(buildMap());

            assert.strictEqual(store.getLastMap(), undefined);
        });

        it("re-overlays the map Valetudo already holds and emits an update", () => {
            const robot = buildRobot({store: store});
            const room = store.upsertRoom(ROOM_RECT, "Kitchen");

            assert.strictEqual(robot.state.map.getSegments().length, 0, "the held map does not know the room yet");

            robot.refreshMapStoreOverlay();

            assert.deepStrictEqual(
                robot.state.map.getSegments().map(s => s.id),
                [room.id],
                "the room is drawn without waiting for a fresh map upload"
            );
            assert.strictEqual(robot.mapUpdatedEvents, 1);
        });

        it("leaves Valetudo's placeholder map alone when refreshing", () => {
            const robot = buildRobot({store: store, map: buildMap({defaultMap: true})});

            store.upsertRoom(ROOM_RECT, "Kitchen");

            robot.refreshMapStoreOverlay();

            assert.strictEqual(robot.state.map.getSegments().length, 0);
            assert.strictEqual(robot.mapUpdatedEvents, 0);
        });

        it("restores the remembered map and its rooms into the robot state", () => {
            store.upsertRoom(ROOM_RECT, "Kitchen");

            buildRobot({store: store}).postProcessMap(buildMap());

            const restartedRobot = buildRobot({store: store, map: buildMap({defaultMap: true})});

            restartedRobot.restoreLastKnownMap();

            assert.strictEqual(
                restartedRobot.state.map.metaData.defaultMap,
                undefined,
                "the placeholder map was replaced by the last known map"
            );
            assert.deepStrictEqual(restartedRobot.state.map.getSegments().map(s => s.name), ["Kitchen"]);
        });

        it("keeps the current map when nothing was remembered", () => {
            const map = buildMap({defaultMap: true});
            const robot = buildRobot({store: store, map: map});

            robot.restoreLastKnownMap();

            assert.strictEqual(robot.state.map, map);
        });
    });

    describe("room cleaning end to end", () => {
        it("turns an overlaid room into an app_zoned_clean command for that rectangle", async () => {
            store.upsertRoom(ROOM_RECT, "Kitchen");

            const map = buildMap();
            const sentCommands = [];
            const robot = withOverlay({
                mapStore: store,
                state: {map: map},
                sendCommand: (method, params) => {
                    sentCommands.push({method: method, params: params});

                    return Promise.resolve();
                }
            });

            robot.postProcessMap(map);

            const segments = map.getSegments();
            assert.strictEqual(segments.length, 1);

            await new capabilities.RoborockV1MapSegmentationCapability({robot: robot}).executeSegmentAction(
                [new ValetudoMapSegment({id: segments[0].id})],
                {iterations: 2}
            );

            assert.deepStrictEqual(sentCommands, [{
                method: "app_zoned_clean",
                params: [[25000, 21200, 35000, 26200, 2]]
            }]);
        });

        it("creates a segment which is then listed and cleanable", async () => {
            const sentCommands = [];
            const robot = buildRobot({
                store: store,
                sendCommand: (method, params) => {
                    sentCommands.push({method: method, params: params});

                    return Promise.resolve();
                }
            });

            const segmentationCapability = new capabilities.RoborockV1MapSegmentationCapability({robot: robot});
            const segment = await segmentationCapability.createSegment(ROOM_RECT, "Living");

            assert.strictEqual(segment.name, "Living");
            assert.deepStrictEqual(
                robot.state.map.getSegments().map(s => s.name),
                ["Living"],
                "the room shows up on the map Valetudo already holds, without a fresh map upload"
            );
            assert.strictEqual(robot.mapUpdatedEvents, 1, "the frontend is told about the new map");

            await segmentationCapability.executeSegmentAction([segment], {});
            assert.strictEqual(sentCommands.length, 1);
        });
    });

    describe("capability getters read from the store, not from the current map", () => {
        it("lists the stored rooms even when the current map has no segment layers", async () => {
            const room = store.upsertRoom(ROOM_RECT, "Kitchen");
            const map = buildMap();
            const robot = {mapStore: store, state: {map: map}};

            assert.strictEqual(map.getSegments().length, 0, "the raw map has no segment layers");

            const segments = await new capabilities.RoborockV1MapSegmentationCapability({robot: robot}).getSegments();

            assert.deepStrictEqual(
                segments.map(segment => {
                    return {id: segment.id, name: segment.name};
                }),
                [{id: room.id, name: "Kitchen"}]
            );
        });

        it("returns saved restrictions without waiting for the next map poll", async () => {
            store.setRestrictions(new ValetudoVirtualRestrictions({
                virtualWalls: [
                    new ValetudoVirtualWall({points: {pA: {x: 100, y: 100}, pB: {x: 200, y: 100}}})
                ],
                restrictedZones: []
            }));

            const map = buildMap();
            const robot = {mapStore: store, state: {map: map}};

            assert.strictEqual(map.entities.filter(entity => {
                return entity.type === "virtual_wall";
            }).length, 0, "the map has not been overlaid yet");

            const restrictions = await new capabilities.RoborockV1CombinedVirtualRestrictionsCapability({robot: robot})
                .getVirtualRestrictions();

            assert.strictEqual(restrictions.virtualWalls.length, 1);
            assert.deepStrictEqual(restrictions.virtualWalls[0].points.pA, {x: 100, y: 100});
        });
    });

    describe("room deletion", () => {
        it("removes the room from the store, the segment list and the map", async () => {
            const room = store.upsertRoom(ROOM_RECT, "Kitchen");

            const map = buildMap();
            const robot = buildRobot({store: store, map: map});

            robot.postProcessMap(map);
            assert.strictEqual(map.getSegments().length, 1, "the room is drawn on the map");

            const capability = new capabilities.RoborockV1MapSegmentationCapability({robot: robot});
            await capability.deleteSegment(new ValetudoMapSegment({id: room.id}));

            assert.deepStrictEqual(await capability.getSegments(), [], "the store no longer lists the room");
            assert.strictEqual(
                robot.state.map.getSegments().length,
                0,
                "the room is dropped from the map Valetudo already holds, without a fresh map upload"
            );
            assert.strictEqual(robot.mapUpdatedEvents, 1, "the frontend is told about the map change");

            await assert.rejects(
                () => capability.deleteSegment(new ValetudoMapSegment({id: room.id})),
                /Room not found/
            );
        });
    });

    describe("capability registration", () => {
        it("exposes the six Gen 1 map capabilities with unique types", () => {
            const robot = {mapStore: store};
            const classes = [
                capabilities.RoborockV1PersistentMapControlCapability,
                capabilities.RoborockV1MapSegmentationCapability,
                capabilities.RoborockV1MapSegmentRenameCapability,
                capabilities.RoborockV1CombinedVirtualRestrictionsCapability,
                capabilities.RoborockV1MapSnapshotCapability,
                capabilities.RoborockV1MapResetCapability
            ];

            const types = classes.map(capabilityClass => {
                return new capabilityClass({robot: robot}).getType();
            });

            assert.deepStrictEqual(types, [
                "PersistentMapControlCapability",
                "MapSegmentationCapability",
                "MapSegmentRenameCapability",
                "CombinedVirtualRestrictionsCapability",
                "MapSnapshotCapability",
                "MapResetCapability"
            ]);
            assert.strictEqual(new Set(types).size, classes.length, "no duplicate capability types");
        });

        it("advertises segment creation through the segmentation capability properties", () => {
            const properties = new capabilities.RoborockV1MapSegmentationCapability({robot: {mapStore: store}})
                .getProperties();

            assert.strictEqual(properties.segmentCreationSupport, true);
            assert.deepStrictEqual(properties.iterationCount, {min: 1, max: 3});
            assert.strictEqual(properties.customOrderSupport, false);
        });

        it("routes a snapshot through the map store", async () => {
            const map = buildMap();
            const robot = {
                mapStore: store,
                state: {map: map},
                emitMapUpdated: () => {}
            };

            store.addSnapshot(JSON.stringify(map), "test");
            const snapshotCapability = new capabilities.RoborockV1MapSnapshotCapability({robot: robot});

            const snapshots = await snapshotCapability.getSnapshots();
            assert.strictEqual(snapshots.length, 1);

            robot.state.map = undefined;
            await snapshotCapability.restoreSnapshot(snapshots[0]);

            assert.ok(robot.state.map instanceof ValetudoMap, "the snapshot restored a ValetudoMap");
            assert.strictEqual(robot.state.map.getSegments().length, 0);
        });
    });
});
