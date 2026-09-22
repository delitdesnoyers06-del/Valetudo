const capabilities = require("./capabilities");
const entities = require("../../entities");
const Logger = require("../../Logger");
const MapLayer = require("../../entities/map/MapLayer");
const MiioValetudoRobot = require("../MiioValetudoRobot");
const RoborockV1MapStore = require("./RoborockV1MapStore");
const RoborockValetudoRobot = require("./RoborockValetudoRobot");
const ValetudoMap = require("../../entities/map/ValetudoMap");



class RoborockV1ValetudoRobot extends RoborockValetudoRobot {
    /**
     *
     * @param {object} options
     * @param {import("../../Configuration")} options.config
     * @param {import("../../ValetudoEventStore")} options.valetudoEventStore
     */
    constructor(options) {
        super(Object.assign({}, options, {fanSpeeds: FAN_SPEEDS}));

        this.registerCapability(new capabilities.RoborockHighResolutionManualControlCapability({
            robot: this,
            velocityLimit: 0.29
        }));

        this.registerCapability(new capabilities.RoborockCarpetModeControlCapability({
            robot: this,
        }));

        this.mapStore = new RoborockV1MapStore({
            filePath: RoborockV1ValetudoRobot.MAP_STORE_PATH
        });

        /**
         * Last anchor we warned about; keeps the map poll from spamming the log
         *
         * @private
         * @type {string|undefined}
         */
        this.lastFloorKeyWarning = undefined;

        // Show the map which was parsed last instead of Valetudo's placeholder until the robot
        // uploads a fresh one; a docked Gen 1 may not do that for hours.
        this.restoreLastKnownMap();

        [
            capabilities.RoborockV1PersistentMapControlCapability,
            capabilities.RoborockV1MapSegmentationCapability,
            capabilities.RoborockV1MapSegmentRenameCapability,
            capabilities.RoborockV1CombinedVirtualRestrictionsCapability,
            capabilities.RoborockV1MapSnapshotCapability,
            capabilities.RoborockV1MapResetCapability,
        ].forEach(capability => {
            this.registerCapability(new capability({robot: this}));
        });
    }

    getModelName() {
        return "V1";
    }

    getModelDetails() {
        return Object.assign(
            {},
            super.getModelDetails(),
            {
                supportedAttachments: []
            }
        );
    }

    /**
     * Applies the stored rooms and restrictions to the given map.
     *
     * Does nothing for maps without floor pixels, for Valetudo's bundled placeholder map and when
     * the user turned Valetudo-side persistence off.
     *
     * @public
     * @param {import("../../entities/map/ValetudoMap")} map
     * @returns {boolean} true if the overlay was applied
     */
    applyMapStoreOverlay(map) {
        if (
            !map ||
            this.mapStore.isPersistentMapEnabled() !== true ||
            map.metaData?.defaultMap === true
        ) {
            return false;
        }

        const floorLayer = map.layers.find(l => l.type === MapLayer.TYPE.FLOOR);

        if (!floorLayer || floorLayer.dimensions?.pixelCount === 0) {
            return false;
        }

        const floorKey = RoborockV1MapStore.floorKeyForMap(map);
        const storedFloorKey = this.mapStore.getFloorKey();

        if (floorKey) {
            if (!storedFloorKey) {
                this.mapStore.setFloorKey(floorKey);
            } else if (!RoborockV1MapStore.floorKeysMatch(storedFloorKey, floorKey)) {
                // Non-destructive on purpose: if the charger anchor really moved (e.g. another floor),
                // the stored rooms may no longer line up, but we never delete the user's data
                // automatically (handoff doubt #2). Warn once per observed anchor so that the frequent
                // map polls (every few seconds while cleaning) cannot spam the log.
                if (this.lastFloorKeyWarning !== floorKey) {
                    this.lastFloorKeyWarning = floorKey;

                    Logger.warn(
                        "Gen1 map store: charger anchor moved (stored " + storedFloorKey + ", observed " + floorKey + "). " +
                        "Stored rooms may no longer line up; they are kept, verify or reset them."
                    );
                }
            }
        }

        this.mapStore.overlay(map);

        return true;
    }

    /**
     * @protected
     * @param {import("../../entities/map/ValetudoMap")} map
     * @returns {import("../../entities/map/ValetudoMap")}
     */
    postProcessMap(map) {
        if (this.applyMapStoreOverlay(map)) {
            this.mapStore.rememberMap(map);
        }

        return map;
    }

    /**
     * Re-applies the store overlay to the map Valetudo currently holds and tells the frontend
     * about it.
     *
     * The Gen 1 firmware only uploads a map when it changed, so while the robot sits on its dock
     * no fresh map is ever parsed. Without this, a room created, renamed or deleted through the
     * frontend - and every restriction change - would only become visible on the map once the
     * robot moves again.
     *
     * @public
     * @returns {void}
     */
    refreshMapStoreOverlay() {
        if (!this.applyMapStoreOverlay(this.state?.map)) {
            return;
        }

        this.mapStore.rememberMap(this.state.map);

        this.emitMapUpdated();
    }

    /**
     * Restores the map which was parsed last from the map store, so that a restart does not blank
     * the map - and with it the persisted rooms - while the robot is docked.
     *
     * @private
     * @returns {void}
     */
    restoreLastKnownMap() {
        const remembered = this.mapStore.getLastMap();

        if (!remembered) {
            return;
        }

        try {
            const map = ValetudoMap.DESERIALIZE(JSON.parse(remembered.map));

            this.applyMapStoreOverlay(map);
            this.state.map = map;
        } catch (e) {
            Logger.warn("Gen1 map store: could not restore the last known map (" + e.message + ")");
        }
    }

    static IMPLEMENTATION_AUTO_DETECTION_HANDLER() {
        const deviceConf = MiioValetudoRobot.READ_DEVICE_CONF(RoborockValetudoRobot.DEVICE_CONF_PATH);

        return !!(deviceConf && deviceConf.model === "rockrobo.vacuum.v1");
    }
}

RoborockV1ValetudoRobot.MAP_STORE_PATH = "/mnt/data/valetudo_gen1_mapstore.json";

const FAN_SPEEDS = {
    [entities.state.attributes.PresetSelectionStateAttribute.INTENSITY.MIN]: 1,
    [entities.state.attributes.PresetSelectionStateAttribute.INTENSITY.LOW]: 38,
    [entities.state.attributes.PresetSelectionStateAttribute.INTENSITY.MEDIUM]: 60,
    [entities.state.attributes.PresetSelectionStateAttribute.INTENSITY.HIGH]: 75,
    [entities.state.attributes.PresetSelectionStateAttribute.INTENSITY.MAX]: 100
};

module.exports = RoborockV1ValetudoRobot;
