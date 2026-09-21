const MapResetCapability = require("../../../core/capabilities/MapResetCapability");

/**
 * Clears the Valetudo-side map metadata (rooms and restrictions) and resets the displayed
 * map. The Gen 1 firmware has no reset_map command.
 *
 * @extends MapResetCapability<import("../RoborockV1ValetudoRobot")>
 */
class RoborockV1MapResetCapability extends MapResetCapability {
    /**
     * @returns {Promise<void>}
     */
    async reset() {
        this.robot.mapStore.clearRoomsAndRestrictions();

        this.robot.clearValetudoMap();
    }
}

module.exports = RoborockV1MapResetCapability;
