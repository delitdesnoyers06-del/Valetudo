const MapSegmentRenameCapability = require("../../../core/capabilities/MapSegmentRenameCapability");

/**
 * Renames Valetudo-side rooms. The Gen 1 firmware has no name_segment / get_room_mapping,
 * so the names live in the map store and are re-applied on every map poll.
 *
 * @extends MapSegmentRenameCapability<import("../RoborockV1ValetudoRobot")>
 */
class RoborockV1MapSegmentRenameCapability extends MapSegmentRenameCapability {
    /**
     * @param {import("../../../entities/core/ValetudoMapSegment")} segment
     * @param {string} name
     * @returns {Promise<void>}
     */
    async renameSegment(segment, name) {
        if (!name || name.length > 23) {
            throw new Error("Invalid name. Max length 23");
        }

        this.robot.mapStore.renameRoom(String(segment.id), name);

        this.robot.refreshMapStoreOverlay();
    }

    /**
     * No-op override (Gen 1).
     *
     * RoborockValetudoRobot.parseMap calls this on every vendorMapId change whenever the
     * MapSegmentRenameCapability TYPE is present. The inherited implementation would issue
     * get_room_mapping, which does not exist on the Gen 1 firmware, so we must not send it.
     * Room names come from the map store instead.
     *
     * @returns {Promise<void>}
     */
    async fetchAndStoreSegmentNames() {
        // Intentionally empty: the Gen 1 firmware has no get_room_mapping command
    }
}

module.exports = RoborockV1MapSegmentRenameCapability;
