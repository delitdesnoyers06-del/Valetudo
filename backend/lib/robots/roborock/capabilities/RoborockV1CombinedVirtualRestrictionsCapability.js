/**
 * @typedef {import("../../../entities/core/ValetudoVirtualRestrictions")} ValetudoVirtualRestrictions
 */

const CombinedVirtualRestrictionsCapability = require("../../../core/capabilities/CombinedVirtualRestrictionsCapability");
const ValetudoRestrictedZone = require("../../../entities/core/ValetudoRestrictedZone");

/**
 * Stores virtual walls and no-go zones in Valetudo's map store and displays them by
 * overlaying map entities onto every parsed map.
 *
 * getVirtualRestrictions() reads them back from the map store, while the overlay additionally
 * adds them to every parsed map as entities so that the frontend can draw them.
 * The Gen 1 only supports regular no-go zones (no mop semantics), hence only
 * ValetudoRestrictedZone.TYPE.REGULAR is advertised.
 *
 * @extends CombinedVirtualRestrictionsCapability<import("../RoborockV1ValetudoRobot")>
 */
class RoborockV1CombinedVirtualRestrictionsCapability extends CombinedVirtualRestrictionsCapability {
    /**
     * @param {object} options
     * @param {import("../RoborockV1ValetudoRobot")} options.robot
     */
    constructor(options) {
        super(Object.assign({}, options, {
            supportedRestrictedZoneTypes: [ValetudoRestrictedZone.TYPE.REGULAR]
        }));
    }

    /**
     * Reads the restrictions from the map store instead of using the inherited implementation,
     * which derives them from the map entities. Those entities only exist after the overlay has
     * run on a freshly parsed map, so relying on them would return an empty set for a few
     * seconds after saving (and before the first successful map poll) - which the frontend would
     * then save back as "no restrictions".
     *
     * @returns {Promise<ValetudoVirtualRestrictions>}
     */
    async getVirtualRestrictions() {
        return this.robot.mapStore.getRestrictions();
    }

    /**
     * @param {ValetudoVirtualRestrictions} virtualRestrictions
     * @returns {Promise<void>}
     */
    async setVirtualRestrictions(virtualRestrictions) {
        this.robot.mapStore.setRestrictions(virtualRestrictions);

        this.robot.refreshMapStoreOverlay();
    }
}

module.exports = RoborockV1CombinedVirtualRestrictionsCapability;
