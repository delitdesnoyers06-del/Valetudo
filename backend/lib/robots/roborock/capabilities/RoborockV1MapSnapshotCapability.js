const MapSnapshotCapability = require("../../../core/capabilities/MapSnapshotCapability");
const ValetudoMap = require("../../../entities/map/ValetudoMap");
const ValetudoMapSnapshot = require("../../../entities/core/ValetudoMapSnapshot");

/**
 * Lists and restores map snapshots which Valetudo stored in its own map store.
 *
 * The Gen 1 firmware cannot restore a map (no recover_map), so restoring a snapshot only
 * changes what Valetudo displays; the robot keeps its current internal map. (handoff doubt #7)
 *
 * @extends MapSnapshotCapability<import("../RoborockV1ValetudoRobot")>
 */
class RoborockV1MapSnapshotCapability extends MapSnapshotCapability {
    /**
     * @returns {Promise<Array<import("../../../entities/core/ValetudoMapSnapshot")>>}
     */
    async getSnapshots() {
        return this.robot.mapStore.listSnapshots().map(snapshot => {
            return new ValetudoMapSnapshot({
                id: snapshot.id,
                timestamp: new Date(snapshot.created * 1000)
            });
        });
    }

    /**
     * @param {import("../../../entities/core/ValetudoMapSnapshot")} snapshot
     * @returns {Promise<void>}
     */
    async restoreSnapshot(snapshot) {
        const storedSnapshot = this.robot.mapStore.getSnapshot(String(snapshot.id));

        if (!storedSnapshot) {
            throw new Error("Snapshot not found");
        }

        const restoredMap = ValetudoMap.DESERIALIZE(JSON.parse(storedSnapshot.map));

        if (this.robot.mapStore.isPersistentMapEnabled()) {
            this.robot.mapStore.overlay(restoredMap);
        }

        this.robot.state.map = restoredMap;

        this.robot.emitMapUpdated();
    }
}

module.exports = RoborockV1MapSnapshotCapability;
