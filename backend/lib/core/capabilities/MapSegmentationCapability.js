const Capability = require("./Capability");
const NotImplementedError = require("../NotImplementedError");

/**
 * @template {import("../ValetudoRobot")} T
 * @extends Capability<T>
 */
class MapSegmentationCapability extends Capability {
    /**
     * @returns {Promise<Array<import("../../entities/core/ValetudoMapSegment")>>}
     */
    async getSegments() {
        return this.robot.state.map.getSegments();
    }

    /**
     * Could be phrased as "cleanSegments" for vacuums or "mowSegments" for lawnmowers
     *
     *
     * @param {Array<import("../../entities/core/ValetudoMapSegment")>} segments
     * @param {object} [options]
     * @param {number} [options.iterations]
     * @param {boolean} [options.customOrder]
     * @returns {Promise<void>}
     */
    async executeSegmentAction(segments, options) {
        throw new NotImplementedError();
    }

    /**
     * Robots which derive their segments from Valetudo-side metadata instead of from the
     * firmware map can optionally support creating new segments ("rooms") at runtime.
     * Implementations which do not override this method will throw a NotImplementedError
     * and must not advertise segmentCreationSupport in getProperties().
     *
     * @param {object} rect An axis-aligned rectangle in cm in the robot's map coordinate space
     * @param {number} rect.x1
     * @param {number} rect.y1
     * @param {number} rect.x2
     * @param {number} rect.y2
     * @param {string} [name]
     * @returns {Promise<import("../../entities/core/ValetudoMapSegment")>} The newly created segment
     */
    async createSegment(rect, name) {
        throw new NotImplementedError();
    }

    /**
     * @returns {MapSegmentationCapabilityProperties}
     */
    getProperties() {
        return {
            iterationCount: {
                min: 1,
                max: 1
            },
            customOrderSupport: false,
            segmentCreationSupport: false
        };
    }

    getType() {
        return MapSegmentationCapability.TYPE;
    }
}

MapSegmentationCapability.TYPE = "MapSegmentationCapability";

module.exports = MapSegmentationCapability;

/**
 * @typedef {object} MapSegmentationCapabilityProperties
 *
 * @property {object} iterationCount
 * @property {number} iterationCount.min
 * @property {number} iterationCount.max
 * 
 * @property {boolean} customOrderSupport
 *
 * @property {boolean} [segmentCreationSupport] Whether or not this robot supports Valetudo-side creation of new segments/rooms
 */
