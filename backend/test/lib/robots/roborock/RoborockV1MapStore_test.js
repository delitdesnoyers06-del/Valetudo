const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { afterEach, beforeEach, describe, it } = require("node:test");

const LineMapEntity = require("../../../../lib/entities/map/entities/LineMapEntity");
const MapLayer = require("../../../../lib/entities/map/MapLayer");
const PointMapEntity = require("../../../../lib/entities/map/entities/PointMapEntity");
const PolygonMapEntity = require("../../../../lib/entities/map/entities/PolygonMapEntity");
const RoborockV1MapStore = require("../../../../lib/robots/roborock/RoborockV1MapStore");
const ValetudoMap = require("../../../../lib/entities/map/ValetudoMap");
const ValetudoRestrictedZone = require("../../../../lib/entities/core/ValetudoRestrictedZone");
const ValetudoVirtualRestrictions = require("../../../../lib/entities/core/ValetudoVirtualRestrictions");
const ValetudoVirtualWall = require("../../../../lib/entities/core/ValetudoVirtualWall");

const KITCHEN_RECT = {x1: 2500, y1: 2500, x2: 3500, y2: 3000};

/**
 * @param {Array<string>} warnings
 * @returns {{warn: (message: string) => void}}
 */
function createLogger(warnings = []) {
    return {
        warn: (message) => {
            warnings.push(message);
        }
    };
}

/**
 * @returns {ValetudoMap}
 */
function buildMap() {
    return new ValetudoMap({
        size: {x: 5120, y: 5120},
        pixelSize: 5,
        layers: [
            new MapLayer({
                type: MapLayer.TYPE.FLOOR,
                pixels: [
                    500, 500,
                    501, 500,
                    500, 501,
                    501, 501
                ]
            }),
            new MapLayer({
                type: MapLayer.TYPE.WALL,
                pixels: [
                    510, 510,
                    511, 510
                ]
            })
        ],
        entities: [
            new PointMapEntity({
                type: PointMapEntity.TYPE.CHARGER_LOCATION,
                points: [2560, 2560]
            })
        ],
        metaData: {
            defaultMap: false
        }
    });
}

/**
 * @returns {ValetudoVirtualRestrictions}
 */
function buildRestrictions() {
    return new ValetudoVirtualRestrictions({
        virtualWalls: [
            new ValetudoVirtualWall({
                points: {
                    pA: {x: 2500, y: 2500},
                    pB: {x: 3000, y: 2500}
                }
            })
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
    });
}

describe("RoborockV1MapStore", () => {
    let tmpDir;
    let filePath;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "valetudo-v1-mapstore-"));
        filePath = path.join(tmpDir, "valetudo_gen1_mapstore.json");
    });

    afterEach(() => {
        fs.rmSync(tmpDir, {recursive: true, force: true});
    });

    describe("load/persist", () => {
        it("uses defaults for a missing store file and is idempotent", () => {
            const store = new RoborockV1MapStore({filePath: filePath});

            store.load();
            store.load();

            assert.strictEqual(store.isPersistentMapEnabled(), true);
            assert.strictEqual(store.getFloorKey(), undefined);
            assert.deepStrictEqual(store.listRooms(), []);
            assert.deepStrictEqual(store.listSnapshots(), []);
            assert.deepStrictEqual(store.getRestrictions().virtualWalls, []);
            assert.deepStrictEqual(store.getRestrictions().restrictedZones, []);
            assert.strictEqual(fs.existsSync(filePath), false);
        });

        it("writes a version 1 file atomically and reloads it", () => {
            const store = new RoborockV1MapStore({filePath: filePath});

            store.setPersistentMapEnabled(false);
            store.setFloorKey("charger:2560,2560");
            const kitchen = store.upsertRoom(KITCHEN_RECT, "Kitchen");

            assert.deepStrictEqual(fs.readdirSync(tmpDir), ["valetudo_gen1_mapstore.json"]);
            assert.strictEqual(fs.existsSync(`${filePath}.tmp`), false);

            const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));

            assert.strictEqual(onDisk.version, 1);
            assert.strictEqual(onDisk.persistentMapEnabled, false);
            assert.strictEqual(onDisk.floorKey, "charger:2560,2560");
            assert.strictEqual(onDisk.nextRoomId, 2);
            assert.deepStrictEqual(onDisk.rooms, {
                "1": {
                    id: "1",
                    name: "Kitchen",
                    rect: KITCHEN_RECT
                }
            });
            assert.deepStrictEqual(onDisk.restrictions, {virtualWalls: [], restrictedZones: []});
            assert.deepStrictEqual(onDisk.snapshots, []);

            const reloaded = new RoborockV1MapStore({filePath: filePath});

            assert.strictEqual(reloaded.isPersistentMapEnabled(), false);
            assert.strictEqual(reloaded.getFloorKey(), "charger:2560,2560");
            assert.deepStrictEqual(reloaded.getRoom("1"), kitchen);
            assert.deepStrictEqual(reloaded.listRooms(), [kitchen]);
        });

        it("moves a malformed file aside and continues with defaults", () => {
            fs.writeFileSync(filePath, "{\"version\": 1, \"rooms\": ", "utf8");

            const warnings = [];
            const store = new RoborockV1MapStore({
                filePath: filePath,
                logger: createLogger(warnings)
            });

            assert.strictEqual(store.isPersistentMapEnabled(), true);
            assert.deepStrictEqual(store.listRooms(), []);

            const remainingFiles = fs.readdirSync(tmpDir);
            const backups = remainingFiles.filter(f => {
                return f.startsWith("valetudo_gen1_mapstore.json.corrupt.");
            });

            assert.strictEqual(backups.length, 1);
            assert.strictEqual(remainingFiles.length, 1);
            assert.strictEqual(fs.existsSync(filePath), false);
            assert.strictEqual(warnings.length, 1);
            assert.strictEqual(
                fs.readFileSync(path.join(tmpDir, backups[0]), "utf8"),
                "{\"version\": 1, \"rooms\": "
            );

            // and the store recovers
            store.setFloorKey("charger:2560,2560");

            assert.strictEqual(fs.existsSync(filePath), true);
            assert.strictEqual(new RoborockV1MapStore({filePath: filePath}).getFloorKey(), "charger:2560,2560");
        });

        it("treats a non-object store file as corrupt", () => {
            fs.writeFileSync(filePath, "[]", "utf8");

            const warnings = [];
            const store = new RoborockV1MapStore({
                filePath: filePath,
                logger: createLogger(warnings)
            });

            assert.strictEqual(store.isPersistentMapEnabled(), true);
            assert.strictEqual(warnings.length, 1);
            assert.strictEqual(fs.readdirSync(tmpDir).filter(f => {
                return f.includes(".corrupt.");
            }).length, 1);
        });
    });

    describe("rectToPixels", () => {
        it("returns a row-major sorted integer pixel array covering both edges", () => {
            const pixels = RoborockV1MapStore.rectToPixels(KITCHEN_RECT, 5);

            assert.strictEqual(pixels.length, 2 * 201 * 101);
            assert.deepStrictEqual(pixels.slice(0, 4), [500, 500, 501, 500]);
            assert.deepStrictEqual(pixels.slice(2 * 200, 2 * 201), [700, 500]);
            assert.deepStrictEqual(pixels.slice(2 * 201, 2 * 201 + 2), [500, 501]);
            assert.deepStrictEqual(pixels.slice(-2), [700, 600]);

            for (let i = 0; i < pixels.length; i++) {
                assert.ok(Number.isInteger(pixels[i]), `pixel ${i} is not an integer`);
            }

            let previousY = -Infinity;
            let previousX = -Infinity;

            for (let i = 0; i < pixels.length; i += 2) {
                const x = pixels[i];
                const y = pixels[i + 1];

                assert.ok(y >= previousY, "y must not decrease");
                if (y === previousY) {
                    assert.ok(x > previousX, "x must increase within a row");
                }

                previousY = y;
                previousX = x;
            }

            // a sorted array compresses to exactly one run per row
            const layer = new MapLayer({
                type: MapLayer.TYPE.SEGMENT,
                pixels: pixels
            });

            assert.strictEqual(layer.compressedPixels.length, 101 * 3);
        });

        it("normalizes reversed rects and rejects unusable input", () => {
            assert.deepStrictEqual(
                RoborockV1MapStore.rectToPixels({x1: 3500, y1: 3000, x2: 2500, y2: 2500}, 5),
                RoborockV1MapStore.rectToPixels(KITCHEN_RECT, 5)
            );

            assert.deepStrictEqual(RoborockV1MapStore.rectToPixels({x1: 100, y1: 100, x2: 200, y2: 200}, 0), []);
            assert.deepStrictEqual(RoborockV1MapStore.rectToPixels({x1: 100, y1: 100, x2: 200, y2: 200}, -5), []);
            assert.deepStrictEqual(RoborockV1MapStore.rectToPixels({x1: 100, y1: 100, x2: NaN, y2: 200}, 5), []);
            assert.deepStrictEqual(RoborockV1MapStore.rectToPixels(undefined, 5), []);
        });
    });

    describe("overlay", () => {
        it("adds a segment layer per room plus the restriction entities and is idempotent", () => {
            const store = new RoborockV1MapStore({filePath: filePath});
            const kitchen = store.upsertRoom(KITCHEN_RECT, "Kitchen");
            const living = store.upsertRoom({x1: 3500, y1: 2500, x2: 4500, y2: 3000}, "Living");

            store.setRestrictions(buildRestrictions());

            const map = buildMap();

            // stale data from a previous overlay must be discarded
            map.addLayer(new MapLayer({
                type: MapLayer.TYPE.SEGMENT,
                pixels: [10, 10],
                metaData: {segmentId: "stale", name: "Stale"}
            }));
            map.addEntity(new LineMapEntity({
                type: LineMapEntity.TYPE.VIRTUAL_WALL,
                points: [1, 1, 2, 2]
            }));
            map.addEntity(new PolygonMapEntity({
                type: PolygonMapEntity.TYPE.NO_GO_AREA,
                points: [1, 1, 2, 1, 2, 2, 1, 2]
            }));

            assert.strictEqual(store.overlay(map), map);

            const segments = map.layers.filter(layer => {
                return layer.type === MapLayer.TYPE.SEGMENT;
            });

            assert.strictEqual(map.layers.length, 4);
            assert.strictEqual(segments.length, 2);

            const kitchenSegment = segments.find(layer => {
                return layer.metaData.segmentId === kitchen.id;
            });
            const livingSegment = segments.find(layer => {
                return layer.metaData.segmentId === living.id;
            });

            assert.ok(kitchenSegment);
            assert.strictEqual(kitchenSegment.metaData.name, "Kitchen");
            assert.strictEqual(kitchenSegment.metaData.active, false);
            assert.deepStrictEqual(MapLayer.DECOMPRESS_PIXELS(kitchenSegment.compressedPixels), RoborockV1MapStore.rectToPixels(kitchen.rect, map.pixelSize));

            assert.ok(livingSegment);
            assert.strictEqual(livingSegment.metaData.name, "Living");
            assert.deepStrictEqual(MapLayer.DECOMPRESS_PIXELS(livingSegment.compressedPixels), RoborockV1MapStore.rectToPixels(living.rect, map.pixelSize));

            assert.deepStrictEqual(map.getSegments().map(segment => {
                return segment.id;
            }), ["1", "2"]);

            const virtualWalls = map.entities.filter(entity => {
                return entity instanceof LineMapEntity && entity.type === LineMapEntity.TYPE.VIRTUAL_WALL;
            });

            assert.strictEqual(virtualWalls.length, 1);
            assert.deepStrictEqual(virtualWalls[0].points, [2500, 2500, 3000, 2500]);

            const noGoAreas = map.entities.filter(entity => {
                return entity instanceof PolygonMapEntity && entity.type === PolygonMapEntity.TYPE.NO_GO_AREA;
            });

            assert.strictEqual(noGoAreas.length, 1);
            assert.deepStrictEqual(noGoAreas[0].points, [2500, 2500, 3000, 2500, 3000, 3000, 2500, 3000]);

            assert.strictEqual(map.entities.length, 3); // charger + virtual wall + restricted zone
            assert.strictEqual(
                map.metaData.totalLayerArea,
                map.layers.reduce((total, layer) => {
                    return total + layer.metaData.area;
                }, 0)
            );

            // the overlay runs on every map poll and on snapshot restores, so it must not accumulate
            const layersBefore = JSON.stringify(map.layers);
            const entitiesBefore = JSON.stringify(map.entities);
            const totalLayerAreaBefore = map.metaData.totalLayerArea;

            store.overlay(map);

            assert.strictEqual(map.layers.length, 4);
            assert.strictEqual(map.entities.length, 3);
            assert.strictEqual(map.metaData.totalLayerArea, totalLayerAreaBefore);
            assert.strictEqual(JSON.stringify(map.layers), layersBefore);
            assert.strictEqual(JSON.stringify(map.entities), entitiesBefore);
        });

        it("maps mop restricted zones to no-mop areas", () => {
            const store = new RoborockV1MapStore({filePath: filePath});

            store.setRestrictions(new ValetudoVirtualRestrictions({
                virtualWalls: [],
                restrictedZones: [
                    new ValetudoRestrictedZone({
                        type: ValetudoRestrictedZone.TYPE.MOP,
                        points: {
                            pA: {x: 10, y: 10},
                            pB: {x: 20, y: 10},
                            pC: {x: 20, y: 20},
                            pD: {x: 10, y: 20}
                        }
                    })
                ]
            }));

            const map = buildMap();

            store.overlay(map);

            assert.strictEqual(map.entities.filter(entity => {
                return entity instanceof PolygonMapEntity && entity.type === PolygonMapEntity.TYPE.NO_MOP_AREA;
            }).length, 1);
            assert.strictEqual(map.entities.filter(entity => {
                return entity instanceof PolygonMapEntity && entity.type === PolygonMapEntity.TYPE.NO_GO_AREA;
            }).length, 0);
        });

        it("leaves a map without rooms and restrictions untouched", () => {
            const store = new RoborockV1MapStore({filePath: filePath});
            const map = buildMap();
            const totalLayerAreaBefore = map.metaData.totalLayerArea;

            store.overlay(map);

            assert.strictEqual(map.layers.length, 2);
            assert.strictEqual(map.entities.length, 1);
            assert.strictEqual(map.metaData.totalLayerArea, totalLayerAreaBefore);
        });
    });

    describe("rooms", () => {
        it("normalizes the rect, defaults the name and never reuses ids", () => {
            const store = new RoborockV1MapStore({filePath: filePath});

            const first = store.upsertRoom({x1: 3500.4, y1: 3000.6, x2: 2500.4, y2: 2500.6});

            assert.strictEqual(first.id, "1");
            assert.strictEqual(first.name, "Room 1");
            assert.deepStrictEqual(first.rect, {x1: 2500, y1: 2501, x2: 3500, y2: 3001});

            const second = store.upsertRoom({x1: 0, y1: 0, x2: 100, y2: 100}, "Kitchen");

            assert.strictEqual(second.id, "2");
            assert.strictEqual(store.removeRoom("1"), true);
            assert.strictEqual(store.removeRoom("1"), false);

            const third = store.upsertRoom({x1: 0, y1: 0, x2: 100, y2: 100}, "Bathroom");

            assert.strictEqual(third.id, "3");
            assert.deepStrictEqual(store.listRooms().map(room => {
                return room.id;
            }), ["2", "3"]);
            assert.strictEqual(store.getRoom("2").name, "Kitchen");
            assert.strictEqual(store.getRoom("42"), undefined);

            assert.throws(() => {
                store.renameRoom("42", "Nope");
            }, /Room not found/);

            assert.strictEqual(store.renameRoom("2", "Living").name, "Living");

            const reloaded = new RoborockV1MapStore({filePath: filePath});

            assert.deepStrictEqual(reloaded.listRooms().map(room => {
                return room.id;
            }), ["2", "3"]);
            assert.strictEqual(reloaded.getRoom("2").name, "Living");
            assert.strictEqual(reloaded.upsertRoom({x1: 0, y1: 0, x2: 100, y2: 100}).id, "4");
        });

        it("refuses to store an unusable rect", () => {
            const store = new RoborockV1MapStore({filePath: filePath});

            assert.throws(() => {
                store.upsertRoom({x1: 0, y1: 0, x2: "nope", y2: 10});
            }, /Invalid room rectangle/);

            assert.strictEqual(fs.existsSync(filePath), false);
        });
    });

    describe("restrictions", () => {
        it("round-trips restrictions through the store as Valetudo entities", () => {
            const store = new RoborockV1MapStore({filePath: filePath});

            store.setRestrictions(new ValetudoVirtualRestrictions({
                virtualWalls: [
                    new ValetudoVirtualWall({
                        points: {
                            pA: {x: 2500.4, y: 2500.6},
                            pB: {x: 3000.4, y: 2500.6}
                        }
                    })
                ],
                restrictedZones: [
                    new ValetudoRestrictedZone({
                        type: ValetudoRestrictedZone.TYPE.MOP,
                        points: {
                            pA: {x: 10, y: 10},
                            pB: {x: 20, y: 10},
                            pC: {x: 20, y: 20},
                            pD: {x: 10, y: 20}
                        }
                    })
                ]
            }));

            const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));

            assert.deepStrictEqual(onDisk.restrictions, {
                virtualWalls: [
                    {
                        points: {
                            pA: {x: 2500, y: 2501},
                            pB: {x: 3000, y: 2501}
                        }
                    }
                ],
                restrictedZones: [
                    {
                        type: "mop",
                        points: {
                            pA: {x: 10, y: 10},
                            pB: {x: 20, y: 10},
                            pC: {x: 20, y: 20},
                            pD: {x: 10, y: 20}
                        }
                    }
                ]
            });

            const restrictions = new RoborockV1MapStore({filePath: filePath}).getRestrictions();

            assert.ok(restrictions instanceof ValetudoVirtualRestrictions);
            assert.strictEqual(restrictions.virtualWalls.length, 1);
            assert.ok(restrictions.virtualWalls[0] instanceof ValetudoVirtualWall);
            assert.deepStrictEqual(restrictions.virtualWalls[0].points, {
                pA: {x: 2500, y: 2501},
                pB: {x: 3000, y: 2501}
            });
            assert.strictEqual(restrictions.restrictedZones.length, 1);
            assert.ok(restrictions.restrictedZones[0] instanceof ValetudoRestrictedZone);
            assert.strictEqual(restrictions.restrictedZones[0].type, ValetudoRestrictedZone.TYPE.MOP);
        });
    });

    describe("snapshots", () => {
        it("caps snapshots at three, drops the oldest and omits the map payload when listing", () => {
            const store = new RoborockV1MapStore({filePath: filePath});

            for (const index of [0, 1, 2, 3, 4]) {
                store.addSnapshot(JSON.stringify({index: index}), `snapshot ${index}`);
            }

            const snapshots = store.listSnapshots();

            assert.strictEqual(snapshots.length, 3);
            assert.deepStrictEqual(snapshots.map(snapshot => {
                return snapshot.label;
            }), ["snapshot 2", "snapshot 3", "snapshot 4"]);

            snapshots.forEach(snapshot => {
                assert.deepStrictEqual(Object.keys(snapshot).sort(), ["created", "id", "label"]);
                assert.strictEqual(typeof snapshot.id, "string");
                assert.ok(snapshot.id.length > 0);
                assert.ok(Number.isInteger(snapshot.created));
                assert.ok(snapshot.created > 0);
            });

            const full = store.getSnapshot(snapshots[2].id);

            assert.strictEqual(full.map, JSON.stringify({index: 4}));
            assert.strictEqual(full.label, "snapshot 4");
            assert.strictEqual(store.getSnapshot("does-not-exist"), undefined);
            assert.strictEqual(store.removeSnapshot(snapshots[2].id), true);
            assert.strictEqual(store.removeSnapshot(snapshots[2].id), false);
            assert.strictEqual(store.listSnapshots().length, 2);

            const reloaded = new RoborockV1MapStore({filePath: filePath});

            assert.strictEqual(reloaded.listSnapshots().length, 2);
            assert.strictEqual(reloaded.getSnapshot(snapshots[0].id).map, JSON.stringify({index: 2}));
        });

        it("stores map objects as stringified JSON", () => {
            const store = new RoborockV1MapStore({filePath: filePath});
            const snapshot = store.addSnapshot({layers: []}, "object input");

            assert.strictEqual(store.getSnapshot(snapshot.id).map, JSON.stringify({layers: []}));
        });

        it("clears rooms, restrictions, floor key and snapshots", () => {
            const store = new RoborockV1MapStore({filePath: filePath});

            store.setFloorKey("charger:2560,2560");
            store.upsertRoom({x1: 0, y1: 0, x2: 100, y2: 100}, "Kitchen");
            store.setRestrictions(buildRestrictions());
            store.addSnapshot(JSON.stringify({index: 0}), "snapshot 0");

            store.clearRoomsAndRestrictions();

            assert.deepStrictEqual(store.listRooms(), []);
            assert.deepStrictEqual(store.listSnapshots(), []);
            assert.strictEqual(store.getFloorKey(), undefined);
            assert.deepStrictEqual(store.getRestrictions().virtualWalls, []);
            assert.deepStrictEqual(store.getRestrictions().restrictedZones, []);

            const reloaded = new RoborockV1MapStore({filePath: filePath});

            assert.deepStrictEqual(reloaded.listRooms(), []);
            assert.deepStrictEqual(reloaded.listSnapshots(), []);
            assert.strictEqual(reloaded.getRestrictions().virtualWalls.length, 0);

            // ids stay monotonic and are never reused after a reset
            assert.strictEqual(reloaded.upsertRoom({x1: 0, y1: 0, x2: 10, y2: 10}).id, "2");
        });
    });

    describe("remembered map", () => {
        it("round trips the map through the store file", () => {
            const store = new RoborockV1MapStore({filePath: filePath});
            const mapJson = JSON.stringify({layers: [{type: "floor"}]});

            assert.strictEqual(store.rememberMap(mapJson), true, "the first call writes the store");

            const remembered = store.getLastMap();

            assert.strictEqual(remembered.map, mapJson);
            assert.ok(Number.isInteger(remembered.created));

            const reloaded = new RoborockV1MapStore({filePath: filePath});

            assert.deepStrictEqual(reloaded.getLastMap(), remembered, "it survives a restart");
        });

        it("keeps the newest map in memory and flushes it with the next store write", () => {
            const store = new RoborockV1MapStore({filePath: filePath});

            assert.strictEqual(store.rememberMap("first"), true);
            assert.strictEqual(store.rememberMap("second"), false, "the file is written at most once per interval");

            assert.strictEqual(store.getLastMap().map, "second", "the in-memory copy is always current");

            store.upsertRoom(KITCHEN_RECT, "Kitchen");

            const reloaded = new RoborockV1MapStore({filePath: filePath});

            assert.strictEqual(reloaded.getLastMap().map, "second", "the next store write flushed the newest copy");
        });

        it("rejects empty payloads and drops a malformed remembered map", () => {
            const store = new RoborockV1MapStore({filePath: filePath});

            assert.strictEqual(store.rememberMap(undefined), false);
            assert.strictEqual(store.rememberMap(""), false);
            assert.strictEqual(store.getLastMap(), undefined);

            fs.writeFileSync(filePath, JSON.stringify({
                version: 1,
                lastMap: {created: "nope", map: 42}
            }));

            const reloaded = new RoborockV1MapStore({filePath: filePath});

            assert.strictEqual(reloaded.getLastMap(), undefined);
        });

        it("forgets the remembered map on request and on a map reset", () => {
            const store = new RoborockV1MapStore({filePath: filePath});

            store.rememberMap("map");
            assert.ok(store.getLastMap());

            store.forgetLastMap();
            assert.strictEqual(store.getLastMap(), undefined);

            store.rememberMap("map again");
            store.clearRoomsAndRestrictions();
            assert.strictEqual(store.getLastMap(), undefined);
        });
    });

    describe("floorKeyForMap", () => {
        it("derives a stable floor key from the charger position", () => {
            assert.strictEqual(RoborockV1MapStore.floorKeyForMap(buildMap()), "charger:2560,2560");
        });

        it("returns undefined without a charger entity", () => {
            const map = new ValetudoMap({
                size: {x: 1000, y: 1000},
                pixelSize: 5,
                layers: [],
                entities: [
                    new PointMapEntity({
                        type: PointMapEntity.TYPE.ROBOT_POSITION,
                        points: [100, 100]
                    })
                ]
            });

            assert.strictEqual(RoborockV1MapStore.floorKeyForMap(map), undefined);
            assert.strictEqual(RoborockV1MapStore.floorKeyForMap({entities: []}), undefined);
            assert.strictEqual(RoborockV1MapStore.floorKeyForMap(undefined), undefined);
        });
    });
});
