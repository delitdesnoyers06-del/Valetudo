const capabilities = require("./capabilities");
const entities = require("../../entities");
const Logger = require("../../Logger");
const MapLayer = require("../../entities/map/MapLayer");
const MiioValetudoRobot = require("../MiioValetudoRobot");
const RoborockV1MapStore = require("./RoborockV1MapStore");
const RoborockValetudoRobot = require("./RoborockValetudoRobot");



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
     * @protected
     * @param {import("../../entities/map/ValetudoMap")} map
     * @returns {import("../../entities/map/ValetudoMap")}
     */
    postProcessMap(map) {
        if (!this.mapStore.isPersistentMapEnabled() || map.metaData?.defaultMap === true) {
            return map;
        }

        const floorLayer = map.layers.find(l => l.type === MapLayer.TYPE.FLOOR);

        if (!floorLayer || floorLayer.dimensions?.pixelCount === 0) {
            return map;
        }

        const floorKey = RoborockV1MapStore.floorKeyForMap(map);

        if (floorKey) {
            if (!this.mapStore.getFloorKey()) {
                this.mapStore.setFloorKey(floorKey);
            } else if (this.mapStore.getFloorKey() !== floorKey) {
                // Non-destructive on purpose: if the charger anchor moved, the stored rooms may no longer
                // line up, but we never delete the user's data automatically (handoff doubt #2).
                Logger.warn(
                    "Gen1 map store: charger anchor moved (stored " + this.mapStore.getFloorKey() + "), " +
                    "stored rooms may no longer line up. Rooms are kept; verify or reset them."
                );
            }
        }

        return this.mapStore.overlay(map);
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
