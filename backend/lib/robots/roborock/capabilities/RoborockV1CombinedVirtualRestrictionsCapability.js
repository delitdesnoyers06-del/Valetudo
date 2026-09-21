/**
 * @typedef {import("../../../entities/core/ValetudoVirtualRestrictions")} ValetudoVirtualRestrictions
 */

const CombinedVirtualRestrictionsCapability = require("../../../core/capabilities/CombinedVirtualRestrictionsCapability");
const ValetudoRestrictedZone = require("../../../entities/core/ValetudoRestrictedZone");

/**
 * Stores virtual walls and no-go zones in Valetudo's map store and displays them by
 * overlaying map entities onto every parsed map.
 *
 * getVirtualRestrictions() is inherited: it reads the restriction entities which the map
 * store overlay adds to the map. The Gen 1 only supports regular no-go zones (no mop
 * semantics), hence only ValetudoRestrictedZone.TYPE.REGULAR is advertised.
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
     * @param {ValetudoVirtualRestrictions} virtualRestrictions
     * @returns {Promise<void>}
     */
    async setVirtualRestrictions(virtualRestrictions) {
        this.robot.mapStore.setRestrictions(virtualRestrictions);

        this.robot.pollMap();
    }
}

module.exports = RoborockV1CombinedVirtualRestrictionsCapability;
