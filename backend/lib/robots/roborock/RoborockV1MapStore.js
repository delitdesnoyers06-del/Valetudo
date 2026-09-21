const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const LineMapEntity = require("../../entities/map/entities/LineMapEntity");
const MapLayer = require("../../entities/map/MapLayer");
const PointMapEntity = require("../../entities/map/entities/PointMapEntity");
const PolygonMapEntity = require("../../entities/map/entities/PolygonMapEntity");
const ValetudoRestrictedZone = require("../../entities/core/ValetudoRestrictedZone");
const ValetudoVirtualRestrictions = require("../../entities/core/ValetudoVirtualRestrictions");
const ValetudoVirtualWall = require("../../entities/core/ValetudoVirtualWall");


/**
 * Persistent, robot-independent storage for the Valetudo-side map metadata of the
 * rockrobo.vacuum.v1 (Gen 1): named rectangular rooms, virtual restrictions and map snapshots.
 *
 * The Gen 1 firmware has no persistent map of its own, so everything room-like lives in
 * Valetudo. This store deliberately keeps no vendor map blobs; the only maps it ever holds are
 * stringified ValetudoMap snapshots, which are capped to MAX_SNAPSHOTS because Valetudo runs
 * with a small heap on Gen 1 hardware.
 *
 * Rooms are stored in cm (the same space as ValetudoMap entities), never in pixels.
 *
 * @class
 */
class RoborockV1MapStore {
    /**
     * @param {object} options
     * @param {string} options.filePath Path of the JSON store file
     * @param {object} [options.logger] Optional logger exposing warn(message). Defaults to the console
     */
    constructor(options) {
        if (!options || typeof options.filePath !== "string" || options.filePath.length === 0) {
            throw new Error("Invalid filePath");
        }

        /** @private */
        this.filePath = options.filePath;
        /** @private */
        this.logger = options.logger ?? console;
        /** @private */
        this.loaded = false;
        /**
         * @private
         * @type {RoborockV1MapStoreData}
         */
        this.data = RoborockV1MapStore.DEFAULT_DATA();
    }

    /**
     * Lazily loads the store file exactly once. A missing file yields defaults; a malformed file
     * is moved aside as `${filePath}.corrupt.<timestamp>` and defaults are used instead, so that
     * data loss is never silent.
     *
     * @public
     * @returns {void}
     */
    load() {
        if (this.loaded) {
            return;
        }

        this.loaded = true;

        let rawContents;
        try {
            rawContents = fs.readFileSync(this.filePath, "utf8");
        } catch (e) {
            if (e.code !== "ENOENT") {
                this._warn(`Could not read map store ${this.filePath} (${e.message}). Continuing with defaults.`);
            }
            return;
        }

        let parsed;
        try {
            parsed = JSON.parse(rawContents);
        } catch (e) {
            this._handleCorruptFile(e);
            return;
        }

        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
            this._handleCorruptFile(new Error("Store file does not contain a JSON object"));
            return;
        }

        this.data = RoborockV1MapStore.NORMALIZE_DATA(parsed);
    }

    /**
     * Atomically writes the store to disk (temp file + rename), so that a power loss cannot leave
     * a half written file behind. No .tmp file is left behind.
     *
     * @public
     * @returns {void}
     */
    persist() {
        this.load();

        const tmpPath = `${this.filePath}.tmp`;

        try {
            fs.mkdirSync(path.dirname(this.filePath), {recursive: true});
            fs.writeFileSync(tmpPath, JSON.stringify(this.data, null, 4), {encoding: "utf8"});
            fs.renameSync(tmpPath, this.filePath);
        } catch (e) {
            try {
                fs.unlinkSync(tmpPath);
            } catch (cleanupError) {
                // there was nothing to clean up
            }

            throw e;
        }
    }

    /**
     * This toggles Valetudo's own persistence for this robot. The robot itself has no persistent
     * map and therefore no idea about this flag.
     *
     * @public
     * @returns {boolean}
     */
    isPersistentMapEnabled() {
        this.load();

        return this.data.persistentMapEnabled;
    }

    /**
     * @public
     * @param {boolean} enabled
     * @returns {void}
     */
    setPersistentMapEnabled(enabled) {
        this.load();

        this.data.persistentMapEnabled = !!enabled;
        this.persist();
    }

    /**
     * @public
     * @returns {string|undefined}
     */
    getFloorKey() {
        this.load();

        return this.data.floorKey;
    }

    /**
     * @public
     * @param {string} floorKey
     * @returns {void}
     */
    setFloorKey(floorKey) {
        this.load();

        this.data.floorKey = floorKey;
        this.persist();
    }

    /**
     * @public
     * @param {string} id
     * @returns {RoborockV1MapStoreRoom|undefined}
     */
    getRoom(id) {
        this.load();

        const room = this.data.rooms[String(id)];

        return room ? RoborockV1MapStore.CLONE(room) : undefined;
    }

    /**
     * @public
     * @returns {Array<RoborockV1MapStoreRoom>}
     */
    listRooms() {
        this.load();

        return Object.values(this.data.rooms).map(room => {
            return RoborockV1MapStore.CLONE(room);
        });
    }

    /**
     * Adds a room for the given rectangle, normalizing it (x1 < x2, y1 < y2, integer cm values).
     * Ids are monotonically increasing strings which are never reused, so segment colours and
     * MQTT/Home Assistant entity ids stay stable.
     *
     * @public
     * @param {RoborockV1MapStoreRect} rect in cm
     * @param {string} [name]
     * @returns {RoborockV1MapStoreRoom}
     */
    upsertRoom(rect, name) {
        this.load();

        const normalizedRect = RoborockV1MapStore.NORMALIZE_RECT(rect);

        if (!normalizedRect) {
            throw new Error("Invalid room rectangle");
        }

        const id = String(this.data.nextRoomId);
        this.data.nextRoomId++;

        const room = {
            id: id,
            name: typeof name === "string" && name.length > 0 ? name : `Room ${id}`,
            rect: normalizedRect
        };

        this.data.rooms[id] = room;
        this.persist();

        return RoborockV1MapStore.CLONE(room);
    }

    /**
     * @public
     * @param {string} id
     * @param {string} name
     * @returns {RoborockV1MapStoreRoom} the renamed room
     */
    renameRoom(id, name) {
        this.load();

        const room = this.data.rooms[String(id)];

        if (!room) {
            throw new Error("Room not found");
        }

        if (typeof name === "string" && name.length > 0) {
            room.name = name;
        }

        this.persist();

        return RoborockV1MapStore.CLONE(room);
    }

    /**
     * @public
     * @param {string} id
     * @returns {boolean} true if a room was removed
     */
    removeRoom(id) {
        this.load();

        const key = String(id);

        if (!Object.hasOwn(this.data.rooms, key)) {
            return false;
        }

        delete this.data.rooms[key];
        this.persist();

        return true;
    }

    /**
     * @public
     * @returns {ValetudoVirtualRestrictions}
     */
    getRestrictions() {
        this.load();

        return new ValetudoVirtualRestrictions({
            virtualWalls: this.data.restrictions.virtualWalls.map(virtualWall => {
                return new ValetudoVirtualWall({
                    points: {
                        pA: {
                            x: virtualWall.points.pA.x,
                            y: virtualWall.points.pA.y
                        },
                        pB: {
                            x: virtualWall.points.pB.x,
                            y: virtualWall.points.pB.y
                        }
                    }
                });
            }),
            restrictedZones: this.data.restrictions.restrictedZones.map(restrictedZone => {
                return new ValetudoRestrictedZone({
                    points: {
                        pA: {
                            x: restrictedZone.points.pA.x,
                            y: restrictedZone.points.pA.y
                        },
                        pB: {
                            x: restrictedZone.points.pB.x,
                            y: restrictedZone.points.pB.y
                        },
                        pC: {
                            x: restrictedZone.points.pC.x,
                            y: restrictedZone.points.pC.y
                        },
                        pD: {
                            x: restrictedZone.points.pD.x,
                            y: restrictedZone.points.pD.y
                        }
                    },
                    type: restrictedZone.type
                });
            })
        });
    }

    /**
     * Stores a plain deep copy of the given restrictions. Coordinates are rounded to integer cm
     * because map entities refuse non-integer coordinates.
     *
     * @public
     * @param {ValetudoVirtualRestrictions} virtualRestrictions
     * @returns {void}
     */
    setRestrictions(virtualRestrictions) {
        this.load();

        this.data.restrictions = RoborockV1MapStore.NORMALIZE_RESTRICTIONS({
            virtualWalls: virtualRestrictions.virtualWalls,
            restrictedZones: virtualRestrictions.restrictedZones
        });

        this.persist();
    }

    /**
     * Deliberately does not contain the (potentially huge) map payload, so that polling clients
     * cannot blow up Valetudo's heap.
     *
     * @public
     * @returns {Array<RoborockV1MapStoreSnapshotPreview>}
     */
    listSnapshots() {
        this.load();

        return this.data.snapshots.map(snapshot => {
            return {
                id: snapshot.id,
                created: snapshot.created,
                label: snapshot.label
            };
        });
    }

    /**
     * @public
     * @param {string|object} mapJson Stringified ValetudoMap JSON. Objects are stringified for convenience
     * @param {string} [label]
     * @returns {RoborockV1MapStoreSnapshot}
     */
    addSnapshot(mapJson, label) {
        this.load();

        const snapshot = {
            id: crypto.randomUUID(),
            created: Math.floor(Date.now() / 1000),
            label: typeof label === "string" ? label : undefined,
            map: typeof mapJson === "string" ? mapJson : JSON.stringify(mapJson)
        };

        this.data.snapshots.push(snapshot);

        while (this.data.snapshots.length > RoborockV1MapStore.MAX_SNAPSHOTS) {
            this.data.snapshots.shift();
        }

        this.persist();

        return {...snapshot};
    }

    /**
     * @public
     * @param {string} id
     * @returns {RoborockV1MapStoreSnapshot|undefined}
     */
    getSnapshot(id) {
        this.load();

        const snapshot = this.data.snapshots.find(s => {
            return s.id === String(id);
        });

        return snapshot ? {...snapshot} : undefined;
    }

    /**
     * @public
     * @param {string} id
     * @returns {boolean} true if a snapshot was removed
     */
    removeSnapshot(id) {
        this.load();

        const index = this.data.snapshots.findIndex(s => {
            return s.id === String(id);
        });

        if (index === -1) {
            return false;
        }

        this.data.snapshots.splice(index, 1);
        this.persist();

        return true;
    }

    /**
     * Clears rooms, restrictions, the floor key and all snapshots. nextRoomId is intentionally not
     * reset so that ids stay monotonic and are never reused.
     *
     * @public
     * @returns {void}
     */
    clearRoomsAndRestrictions() {
        this.load();

        this.data.rooms = {};
        this.data.restrictions = {
            virtualWalls: [],
            restrictedZones: []
        };
        this.data.floorKey = undefined;
        this.data.snapshots = [];

        this.persist();
    }

    /**
     * Applies the stored rooms and restrictions to a freshly parsed map. The Gen 1 firmware never
     * produces segment layers and never reports user restrictions, so anything previously
     * overlaid is dropped and re-added. This makes the operation idempotent, which matters because
     * it runs on every map poll and on every snapshot restore.
     *
     * Mutates and returns the given map.
     *
     * @public
     * @param {import("../../entities/map/ValetudoMap")} map
     * @returns {import("../../entities/map/ValetudoMap")}
     */
    overlay(map) {
        this.load();

        map.layers = map.layers.filter(layer => {
            return layer.type !== MapLayer.TYPE.SEGMENT;
        });

        map.entities = map.entities.filter(entity => {
            return !RoborockV1MapStore.IS_RESTRICTION_ENTITY(entity);
        });

        map.metaData.totalLayerArea = map.layers.reduce((total, layer) => {
            return total + (layer.metaData.area ?? 0);
        }, 0);

        for (const room of this.listRooms()) {
            const pixels = RoborockV1MapStore.rectToPixels(room.rect, map.pixelSize);

            if (pixels.length === 0) {
                continue;
            }

            map.addLayer(new MapLayer({
                type: MapLayer.TYPE.SEGMENT,
                pixels: pixels,
                metaData: {
                    segmentId: String(room.id),
                    name: room.name,
                    active: false
                }
            }));
        }

        const restrictions = this.getRestrictions();

        for (const virtualWall of restrictions.virtualWalls) {
            map.addEntity(new LineMapEntity({
                type: LineMapEntity.TYPE.VIRTUAL_WALL,
                points: [
                    virtualWall.points.pA.x,
                    virtualWall.points.pA.y,
                    virtualWall.points.pB.x,
                    virtualWall.points.pB.y
                ]
            }));
        }

        for (const restrictedZone of restrictions.restrictedZones) {
            map.addEntity(new PolygonMapEntity({
                type: restrictedZone.type === ValetudoRestrictedZone.TYPE.MOP ?
                    PolygonMapEntity.TYPE.NO_MOP_AREA :
                    PolygonMapEntity.TYPE.NO_GO_AREA,
                points: [
                    restrictedZone.points.pA.x,
                    restrictedZone.points.pA.y,
                    restrictedZone.points.pB.x,
                    restrictedZone.points.pB.y,
                    restrictedZone.points.pC.x,
                    restrictedZone.points.pC.y,
                    restrictedZone.points.pD.x,
                    restrictedZone.points.pD.y
                ]
            }));
        }

        return map;
    }

    /**
     * Converts a cm rectangle into the row-major sorted, integer pixel array which MapLayer's RLE
     * compressor expects: for ascending y, for ascending x, both edges inclusive.
     *
     * Returns an empty array if the rectangle cannot be used (which is also what makes rooms
     * with degenerate rects simply disappear from the overlay).
     *
     * @public
     * @param {RoborockV1MapStoreRect|undefined} rect in cm
     * @param {number} pixelSize in cm
     * @returns {Array<number>} [x,y,x+1,y,...]
     */
    static rectToPixels(rect, pixelSize) {
        if (!rect || typeof rect !== "object" || !Number.isFinite(pixelSize) || pixelSize <= 0) {
            return [];
        }

        if (![rect.x1, rect.y1, rect.x2, rect.y2].every(value => Number.isFinite(value))) {
            return [];
        }

        const xStart = Math.round(Math.min(rect.x1, rect.x2) / pixelSize);
        const xEnd = Math.round(Math.max(rect.x1, rect.x2) / pixelSize);
        const yStart = Math.round(Math.min(rect.y1, rect.y2) / pixelSize);
        const yEnd = Math.round(Math.max(rect.y1, rect.y2) / pixelSize);

        if (xEnd < xStart || yEnd < yStart) {
            return [];
        }

        const pixels = [];

        for (let y = yStart; y <= yEnd; y++) {
            for (let x = xStart; x <= xEnd; x++) {
                pixels.push(x, y);
            }
        }

        return pixels;
    }

    /**
     * Heuristic anchor to detect that the robot was moved to a different floor: as long as the
     * robot stays on the same map, its charger position does not move.
     *
     * @public
     * @param {import("../../entities/map/ValetudoMap")} map
     * @returns {string|undefined}
     */
    static floorKeyForMap(map) {
        const entities = (map && map.entities) ?? [];

        const charger = entities.find(entity => {
            return entity &&
                entity.type === PointMapEntity.TYPE.CHARGER_LOCATION &&
                Array.isArray(entity.points) &&
                entity.points.length >= 2;
        });

        if (!charger) {
            return undefined;
        }

        return `charger:${Math.round(charger.points[0])},${Math.round(charger.points[1])}`;
    }

    /**
     * @private
     * @returns {RoborockV1MapStoreData}
     */
    static DEFAULT_DATA() {
        return {
            version: RoborockV1MapStore.VERSION,
            persistentMapEnabled: true,
            floorKey: undefined,
            nextRoomId: 1,
            rooms: {},
            restrictions: {
                virtualWalls: [],
                restrictedZones: []
            },
            snapshots: []
        };
    }

    /**
     * @private
     * @param {any} raw
     * @returns {RoborockV1MapStoreData}
     */
    static NORMALIZE_DATA(raw) {
        const data = RoborockV1MapStore.DEFAULT_DATA();

        data.version = Number.isInteger(raw.version) && raw.version > 0 ? raw.version : data.version;
        data.persistentMapEnabled = typeof raw.persistentMapEnabled === "boolean" ? raw.persistentMapEnabled : data.persistentMapEnabled;
        data.floorKey = typeof raw.floorKey === "string" ? raw.floorKey : undefined;
        data.rooms = RoborockV1MapStore.NORMALIZE_ROOMS(raw.rooms);

        let highestRoomId = 0;
        for (const id of Object.keys(data.rooms)) {
            const numericId = parseInt(id, 10);
            if (Number.isInteger(numericId) && numericId > highestRoomId) {
                highestRoomId = numericId;
            }
        }

        data.nextRoomId = Number.isInteger(raw.nextRoomId) && raw.nextRoomId > highestRoomId ? raw.nextRoomId : highestRoomId + 1;
        data.restrictions = RoborockV1MapStore.NORMALIZE_RESTRICTIONS(raw.restrictions);
        data.snapshots = RoborockV1MapStore.NORMALIZE_SNAPSHOTS(raw.snapshots);

        return data;
    }

    /**
     * @private
     * @param {any} rawRooms
     * @returns {Object<string, RoborockV1MapStoreRoom>}
     */
    static NORMALIZE_ROOMS(rawRooms) {
        /** @type {Object<string, RoborockV1MapStoreRoom>} */
        const rooms = {};

        if (!rawRooms || typeof rawRooms !== "object" || Array.isArray(rawRooms)) {
            return rooms;
        }

        for (const [key, room] of Object.entries(rawRooms)) {
            if (!room || typeof room !== "object") {
                continue;
            }

            const rect = RoborockV1MapStore.NORMALIZE_RECT(room.rect);

            if (!rect) {
                continue;
            }

            const id = String(key);

            rooms[id] = {
                id: id,
                name: typeof room.name === "string" && room.name.length > 0 ? room.name : `Room ${id}`,
                rect: rect
            };
        }

        return rooms;
    }

    /**
     * @private
     * @param {any} rect
     * @returns {RoborockV1MapStoreRect|undefined}
     */
    static NORMALIZE_RECT(rect) {
        if (!rect || typeof rect !== "object") {
            return undefined;
        }

        if (![rect.x1, rect.y1, rect.x2, rect.y2].every(value => Number.isFinite(value))) {
            return undefined;
        }

        const values = [rect.x1, rect.y1, rect.x2, rect.y2].map(value => Math.round(value));

        return {
            x1: Math.min(values[0], values[2]),
            y1: Math.min(values[1], values[3]),
            x2: Math.max(values[0], values[2]),
            y2: Math.max(values[1], values[3])
        };
    }

    /**
     * @private
     * @param {any} rawRestrictions
     * @returns {RoborockV1MapStoreRestrictions}
     */
    static NORMALIZE_RESTRICTIONS(rawRestrictions) {
        /** @type {RoborockV1MapStoreRestrictions} */
        const restrictions = {
            virtualWalls: [],
            restrictedZones: []
        };

        if (!rawRestrictions || typeof rawRestrictions !== "object") {
            return restrictions;
        }

        if (Array.isArray(rawRestrictions.virtualWalls)) {
            for (const virtualWall of rawRestrictions.virtualWalls) {
                const points = RoborockV1MapStore.NORMALIZE_POINTS(virtualWall?.points, ["pA", "pB"]);

                if (points) {
                    restrictions.virtualWalls.push({
                        points: points
                    });
                }
            }
        }

        if (Array.isArray(rawRestrictions.restrictedZones)) {
            for (const restrictedZone of rawRestrictions.restrictedZones) {
                const points = RoborockV1MapStore.NORMALIZE_POINTS(restrictedZone?.points, ["pA", "pB", "pC", "pD"]);

                if (points) {
                    restrictions.restrictedZones.push({
                        type: restrictedZone.type === ValetudoRestrictedZone.TYPE.MOP ? ValetudoRestrictedZone.TYPE.MOP : ValetudoRestrictedZone.TYPE.REGULAR,
                        points: points
                    });
                }
            }
        }

        return restrictions;
    }

    /**
     * @private
     * @param {any} rawPoints
     * @param {Array<string>} keys
     * @returns {any|undefined}
     */
    static NORMALIZE_POINTS(rawPoints, keys) {
        if (!rawPoints || typeof rawPoints !== "object") {
            return undefined;
        }

        const points = {};

        for (const key of keys) {
            const point = rawPoints[key];

            if (!point || typeof point !== "object" || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
                return undefined;
            }

            points[key] = {
                x: Math.round(point.x),
                y: Math.round(point.y)
            };
        }

        return points;
    }

    /**
     * @private
     * @param {any} rawSnapshots
     * @returns {Array<RoborockV1MapStoreSnapshot>}
     */
    static NORMALIZE_SNAPSHOTS(rawSnapshots) {
        /** @type {Array<RoborockV1MapStoreSnapshot>} */
        const snapshots = [];

        if (!Array.isArray(rawSnapshots)) {
            return snapshots;
        }

        for (const snapshot of rawSnapshots) {
            if (!snapshot || typeof snapshot !== "object" || typeof snapshot.map !== "string") {
                continue;
            }

            snapshots.push({
                id: typeof snapshot.id === "string" && snapshot.id.length > 0 ? snapshot.id : crypto.randomUUID(),
                created: Number.isInteger(snapshot.created) ? snapshot.created : Math.floor(Date.now() / 1000),
                label: typeof snapshot.label === "string" ? snapshot.label : undefined,
                map: snapshot.map
            });
        }

        return snapshots.slice(-RoborockV1MapStore.MAX_SNAPSHOTS);
    }

    /**
     * @private
     * @param {any} entity
     * @returns {boolean}
     */
    static IS_RESTRICTION_ENTITY(entity) {
        if (entity instanceof LineMapEntity) {
            return entity.type === LineMapEntity.TYPE.VIRTUAL_WALL;
        }

        if (entity instanceof PolygonMapEntity) {
            return entity.type === PolygonMapEntity.TYPE.NO_GO_AREA ||
                entity.type === PolygonMapEntity.TYPE.NO_MOP_AREA;
        }

        return false;
    }

    /**
     * @private
     * @param {any} value
     * @returns {any}
     */
    static CLONE(value) {
        return JSON.parse(JSON.stringify(value));
    }

    /**
     * @private
     * @param {Error} error
     * @returns {void}
     */
    _handleCorruptFile(error) {
        const backupPath = `${this.filePath}.corrupt.${Date.now()}`;

        try {
            fs.renameSync(this.filePath, backupPath);
            this._warn(`Map store ${this.filePath} is corrupt (${error.message}). Moved it to ${backupPath} and continued with defaults.`);
        } catch (e) {
            this._warn(`Map store ${this.filePath} is corrupt (${error.message}) and could not be moved aside (${e.message}). Continuing with defaults.`);
        }
    }

    /**
     * @private
     * @param {string} message
     * @returns {void}
     */
    _warn(message) {
        this.logger.warn(message);
    }
}

RoborockV1MapStore.VERSION = 1;

RoborockV1MapStore.MAX_SNAPSHOTS = 3;

module.exports = RoborockV1MapStore;

/**
 * @typedef {object} RoborockV1MapStoreRect
 * @property {number} x1 in cm
 * @property {number} y1 in cm
 * @property {number} x2 in cm
 * @property {number} y2 in cm
 */

/**
 * @typedef {object} RoborockV1MapStoreRoom
 * @property {string} id
 * @property {string} name
 * @property {RoborockV1MapStoreRect} rect in cm
 */

/**
 * @typedef {object} RoborockV1MapStorePoint
 * @property {number} x in cm
 * @property {number} y in cm
 */

/**
 * @typedef {object} RoborockV1MapStoreVirtualWallPoints
 * @property {RoborockV1MapStorePoint} pA
 * @property {RoborockV1MapStorePoint} pB
 */

/**
 * @typedef {object} RoborockV1MapStoreRestrictedZonePoints
 * @property {RoborockV1MapStorePoint} pA
 * @property {RoborockV1MapStorePoint} pB
 * @property {RoborockV1MapStorePoint} pC
 * @property {RoborockV1MapStorePoint} pD
 */

/**
 * @typedef {object} RoborockV1MapStoreVirtualWall
 * @property {RoborockV1MapStoreVirtualWallPoints} points
 */

/**
 * @typedef {object} RoborockV1MapStoreRestrictedZone
 * @property {string} type "regular" or "mop"
 * @property {RoborockV1MapStoreRestrictedZonePoints} points
 */

/**
 * @typedef {object} RoborockV1MapStoreRestrictions
 * @property {Array<RoborockV1MapStoreVirtualWall>} virtualWalls
 * @property {Array<RoborockV1MapStoreRestrictedZone>} restrictedZones
 */

/**
 * @typedef {object} RoborockV1MapStoreSnapshot
 * @property {string} id
 * @property {number} created unix seconds
 * @property {string} [label]
 * @property {string} map stringified ValetudoMap JSON
 */

/**
 * @typedef {object} RoborockV1MapStoreSnapshotPreview
 * @property {string} id
 * @property {number} created unix seconds
 * @property {string} [label]
 */

/**
 * @typedef {object} RoborockV1MapStoreData
 * @property {number} version
 * @property {boolean} persistentMapEnabled
 * @property {string} [floorKey]
 * @property {number} nextRoomId
 * @property {Object<string, RoborockV1MapStoreRoom>} rooms
 * @property {RoborockV1MapStoreRestrictions} restrictions
 * @property {Array<RoborockV1MapStoreSnapshot>} snapshots
 */
