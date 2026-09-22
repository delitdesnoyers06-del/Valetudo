const MapSegmentationCapability = require("../../../core/capabilities/MapSegmentationCapability");
const RoborockMapParser = require("../RoborockMapParser");
const ValetudoMapSegment = require("../../../entities/core/ValetudoMapSegment");

/**
 * The Gen 1 firmware has no app_segment_clean command, so "rooms" are Valetudo-side
 * axis-aligned rectangles which are cleaned through app_zoned_clean
 * (max 5 zones per command, iterations 1..3).
 *
 * @extends MapSegmentationCapability<import("../RoborockV1ValetudoRobot")>
 */
class RoborockV1MapSegmentationCapability extends MapSegmentationCapability {
    /**
     * Transforms a Valetudo room rectangle (cm) into an app_zoned_clean zone tuple (mm).
     *
     * The transform is bit-identical to RoborockZoneCleaningCapability.start():
     * cm -> mm (x10) and a y-flip around RoborockMapParser.DIMENSION_MM, followed by the
     * min/max normalisation which enforces x1 < x2 and y1 < y2.
     *
     * @param {{x1: number, y1: number, x2: number, y2: number}} rect the room rectangle in cm
     * @param {number} iterations the number of cleaning passes (1..3)
     * @returns {Array<number>} [x1, y1, x2, y2, iterations] in mm
     */
    static ROOM_TO_ZONE(rect, iterations) {
        const yFlippedZone = [
            Math.floor(rect.x1 * 10),
            Math.floor(RoborockMapParser.DIMENSION_MM - rect.y1 * 10),
            Math.floor(rect.x2 * 10),
            Math.floor(RoborockMapParser.DIMENSION_MM - rect.y2 * 10),
            iterations
        ];

        // it seems as the vacuum only works with 'positive rectangles'! So flip the coordinates if the user entered them wrong.
        // x1 has to be < x2 and y1 < y2
        return [
            Math.min(yFlippedZone[0], yFlippedZone[2]),
            Math.min(yFlippedZone[1], yFlippedZone[3]),

            Math.max(yFlippedZone[0], yFlippedZone[2]),
            Math.max(yFlippedZone[1], yFlippedZone[3]),

            yFlippedZone[4]
        ];
    }

    /**
     * Rooms are Valetudo-side metadata, so the authoritative list is the map store rather
     * than the currently parsed map. This also keeps the room list available while the robot
     * has not (yet) uploaded a parseable map, which is common right after a reboot.
     *
     * @returns {Promise<Array<import("../../../entities/core/ValetudoMapSegment")>>}
     */
    async getSegments() {
        return this.robot.mapStore.listRooms().map(room => {
            return new ValetudoMapSegment({
                id: String(room.id),
                name: room.name
            });
        });
    }

    /**
     * Cleans the Valetudo rooms behind the given segment ids.
     *
     * Unknown ids are ignored; if none of the ids resolve to a stored room nothing is sent.
     * app_zoned_clean accepts at most 5 zones per command, so the rooms are chunked and sent
     * sequentially. Between two batches a fixed delay is awaited: whether the Gen 1 queues or
     * drops a zone command issued while it is still cleaning has not been verified on hardware
     * (handoff doubt #5), so this is a documented best-effort.
     *
     * @param {Array<import("../../../entities/core/ValetudoMapSegment")>} segments
     * @param {object} [options]
     * @param {number} [options.iterations]
     * @returns {Promise<void>}
     */
    async executeSegmentAction(segments, options) {
        const iterations = Math.max(1, Math.min(3, options?.iterations ?? 1));

        const rooms = segments
            .map(segment => this.robot.mapStore.getRoom(String(segment.id)))
            .filter(Boolean);

        if (rooms.length === 0) {
            return;
        }

        for (let i = 0; i < rooms.length; i += ZONE_BATCH_SIZE) {
            const zones = rooms
                .slice(i, i + ZONE_BATCH_SIZE)
                .map(room => RoborockV1MapSegmentationCapability.ROOM_TO_ZONE(room.rect, iterations));

            await this.robot.sendCommand("app_zoned_clean", zones, {});

            if (i + ZONE_BATCH_SIZE < rooms.length) {
                await new Promise(resolve => setTimeout(resolve, ZONE_BATCH_DELAY_MS));
            }
        }
    }

    /**
     * Creates a new Valetudo-managed room from an axis-aligned rectangle (cm).
     *
     * This is the room-creation path for robots whose firmware has no segmentation at all
     * (handoff doubt #1). The frontend exposes it as the "Create Room" action in the map
     * editing view; it can also be called through the REST API with
     * {action: "create_segment", name, rect} on the MapSegmentationCapability route.
     * The created room is drawn on the next map poll because the map store overlays its
     * rooms onto every parsed map.
     *
     * @param {{x1: number, y1: number, x2: number, y2: number}} rect the room rectangle in cm
     * @param {string} [name] the room name; a missing, empty or longer than 23 character name is rejected
     * @returns {Promise<import("../../../entities/core/ValetudoMapSegment")>} the created segment
     */
    async createSegment(rect, name) {
        if (!name || name.length > 23) {
            throw new Error("Invalid name. Max length 23");
        }

        const room = this.robot.mapStore.upsertRoom(rect, name);

        this.robot.refreshMapStoreOverlay();

        return new ValetudoMapSegment({
            id: String(room.id),
            name: room.name
        });
    }

    /**
     * Removes a Valetudo-managed room. Ids are never reused, so existing rooms and their colours
     * keep their identity (handoff doubt #9).
     *
     * @param {import("../../../entities/core/ValetudoMapSegment")} segment
     * @returns {Promise<void>}
     */
    async deleteSegment(segment) {
        if (this.robot.mapStore.removeRoom(String(segment.id)) !== true) {
            throw new Error("Room not found");
        }

        this.robot.refreshMapStoreOverlay();
    }

    /**
     * @returns {import("../../../core/capabilities/MapSegmentationCapability").MapSegmentationCapabilityProperties}
     */
    getProperties() {
        return {
            iterationCount: {
                min: 1,
                max: 3
            },
            customOrderSupport: false,
            segmentCreationSupport: true
        };
    }
}

/** The firmware only accepts 5 zones per app_zoned_clean command */
const ZONE_BATCH_SIZE = 5;
/** Best-effort delay between two app_zoned_clean commands (handoff doubt #5) */
const ZONE_BATCH_DELAY_MS = 5000;

module.exports = RoborockV1MapSegmentationCapability;
