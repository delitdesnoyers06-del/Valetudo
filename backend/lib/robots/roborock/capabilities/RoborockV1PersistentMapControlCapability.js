const PersistentMapControlCapability = require("../../../core/capabilities/PersistentMapControlCapability");

/**
 * Enables or disables Valetudo's own persistent map handling for the Gen 1 robot.
 *
 * IMPORTANT: unlike every other robot, "persistent map" on the Gen 1 does NOT toggle a
 * firmware feature. The Gen 1 firmware has no persistent-map / lab_status support at all;
 * enabling this only makes Valetudo store the map, the rooms and the virtual restrictions
 * in its own map store and re-apply them to every freshly parsed map.
 *
 * @extends PersistentMapControlCapability<import("../RoborockV1ValetudoRobot")>
 */
class RoborockV1PersistentMapControlCapability extends PersistentMapControlCapability {
    /**
     * @param {object} options
     * @param {import("../RoborockV1ValetudoRobot")} options.robot
     */
    constructor(options) {
        super(options);
    }

    /**
     * @returns {Promise<boolean>}
     */
    async isEnabled() {
        return this.robot.mapStore.isPersistentMapEnabled();
    }

    /**
     * @returns {Promise<void>}
     */
    async enable() {
        this.robot.mapStore.setPersistentMapEnabled(true);

        // Rooms and restrictions become visible right away instead of on the next map upload
        this.robot.refreshMapStoreOverlay();
    }

    /**
     * @returns {Promise<void>}
     */
    async disable() {
        this.robot.mapStore.setPersistentMapEnabled(false);

        // Drops the overlaid rooms and restrictions from the map Valetudo currently holds
        this.robot.refreshMapStoreOverlay();
    }
}

module.exports = RoborockV1PersistentMapControlCapability;
