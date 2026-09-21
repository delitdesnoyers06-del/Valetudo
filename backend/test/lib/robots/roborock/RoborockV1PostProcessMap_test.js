const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const capabilities = require("../../../../lib/robots/roborock/capabilities");
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

    return new ValetudoMap({
        size: {x: 5120, y: 5120},
        pixelSize: 5,
        layers: layers,
        entities: [
            new PointMapEntity({
                type: PointMapEntity.TYPE.CHARGER_LOCATION,
                points: CHARGER_POINT
            })
        ],
        metaData: options.defaultMap === true ? {defaultMap: true} : {}
    });
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
            const robot = {mapStore: store, state: {map: map}};

            const result = RoborockV1ValetudoRobot.prototype.postProcessMap.call(robot, map);

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
            const robot = {mapStore: store};

            RoborockV1ValetudoRobot.prototype.postProcessMap.call(robot, map);
            RoborockV1ValetudoRobot.prototype.postProcessMap.call(robot, map);
            RoborockV1ValetudoRobot.prototype.postProcessMap.call(robot, map);

            assert.strictEqual(map.layers.filter(layer => layer.type === MapLayer.TYPE.SEGMENT).length, 1);
            assert.strictEqual(map.getSegments().length, 1);
        });

        it("does not touch the map when Valetudo-side persistence is disabled", () => {
            store.upsertRoom(ROOM_RECT, "Kitchen");
            store.setPersistentMapEnabled(false);

            const map = buildMap();
            RoborockV1ValetudoRobot.prototype.postProcessMap.call({mapStore: store}, map);

            assert.strictEqual(map.getSegments().length, 0);
            assert.strictEqual(store.getFloorKey(), undefined);
        });

        it("does not overlay the default (empty) map", () => {
            store.upsertRoom(ROOM_RECT, "Kitchen");

            const map = buildMap({defaultMap: true});
            RoborockV1ValetudoRobot.prototype.postProcessMap.call({mapStore: store}, map);

            assert.strictEqual(map.getSegments().length, 0);
        });

        it("does not overlay a map which has no floor layer", () => {
            store.upsertRoom(ROOM_RECT, "Kitchen");

            const map = buildMap({withFloorLayer: false});
            RoborockV1ValetudoRobot.prototype.postProcessMap.call({mapStore: store}, map);

            assert.strictEqual(map.getSegments().length, 0);
        });
    });

    describe("room cleaning end to end", () => {
        it("turns an overlaid room into an app_zoned_clean command for that rectangle", async () => {
            store.upsertRoom(ROOM_RECT, "Kitchen");

            const map = buildMap();
            const sentCommands = [];
            const robot = {
                mapStore: store,
                state: {map: map},
                pollMap: () => {},
                sendCommand: (method, params) => {
                    sentCommands.push({method: method, params: params});

                    return Promise.resolve();
                }
            };

            RoborockV1ValetudoRobot.prototype.postProcessMap.call(robot, map);

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
            const robot = {
                mapStore: store,
                pollMap: () => {},
                sendCommand: (method, params) => {
                    sentCommands.push({method: method, params: params});

                    return Promise.resolve();
                }
            };

            const segmentationCapability = new capabilities.RoborockV1MapSegmentationCapability({robot: robot});
            const segment = await segmentationCapability.createSegment(ROOM_RECT, "Living");

            assert.strictEqual(segment.name, "Living");

            const map = buildMap();
            RoborockV1ValetudoRobot.prototype.postProcessMap.call(robot, map);
            assert.deepStrictEqual(map.getSegments().map(s => s.name), ["Living"]);

            await segmentationCapability.executeSegmentAction([segment], {});
            assert.strictEqual(sentCommands.length, 1);
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
                emitMapUpdated: () => {},
                pollMap: () => {}
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
