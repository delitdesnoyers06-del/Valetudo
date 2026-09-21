import {
    Capability,
    MapSegmentMaterial,
    RawMapLayerMaterial,
    StatusState,
    useCombinedVirtualRestrictionsMutation,
    useCombinedVirtualRestrictionsQuery,
    useCreateSegmentMutation,
    useDeleteSegmentMutation,
    useJoinSegmentsMutation,
    useMapSegmentationPropertiesQuery,
    useMapSegmentMaterialControlPropertiesQuery,
    useRenameSegmentMutation,
    useSetSegmentMaterialMutation,
    useSplitSegmentMutation,
    ValetudoRestrictedZoneType
} from "../../../api";
import React from "react";
import {
    Button,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogContentText,
    DialogTitle,
    FormControl,
    FormControlLabel,
    Grid2,
    Radio,
    RadioGroup,
    TextField,
    Typography
} from "@mui/material";
import {ActionButton} from "../../Styled";
import CuttingLineClientStructure from "../../structures/client_structures/CuttingLineClientStructure";
import NoGoAreaClientStructure from "../../structures/client_structures/NoGoAreaClientStructure";
import {PointCoordinates} from "../../utils/types";
import {
    Add as AddIcon,
    Clear as ClearIcon,
    ContentCut as SplitIcon,
    Dashboard as MaterialIcon,
    Delete as DeleteIcon,
    JoinFull as JoinIcon,
} from "@mui/icons-material";
import {AddCuttingLineIcon, RenameIcon} from "../../../components/CustomIcons";

const getMaterialLabel = (material: MapSegmentMaterial): string => {
    switch (material) {
        case MapSegmentMaterial.Generic:
            return "Generic";
        case MapSegmentMaterial.Tile:
            return "Tile";
        case MapSegmentMaterial.Wood:
            return "Wood";
        case MapSegmentMaterial.WoodHorizontal:
            return "Wood (Horizontal)";
        case MapSegmentMaterial.WoodVertical:
            return "Wood (Vertical)";
        case MapSegmentMaterial.Carpet:
            return "Carpet";
        case MapSegmentMaterial.CarpetLow:
            return "Carpet (Low)";
        case MapSegmentMaterial.CarpetHigh:
            return "Carpet (High)";
        default:
            return material;
    }
};

interface SegmentRenameDialogProps {
    open: boolean;
    onClose: () => void;
    currentName: string;
    onRename: (newName: string) => void;
}

const SegmentRenameDialog = (props: SegmentRenameDialogProps) => {
    const {open, onClose, currentName, onRename} = props;
    const [name, setName] = React.useState(currentName);

    React.useEffect(() => {
        if (open) {
            setName(currentName);
        }
    }, [open, currentName]);

    return (
        <Dialog open={open} onClose={onClose} sx={{userSelect: "none"}}>
            <DialogTitle>Rename Segment</DialogTitle>
            <DialogContent>
                <DialogContentText>
                    How should the segment &apos;{currentName}&apos; be called?
                </DialogContentText>
                <TextField
                    autoFocus
                    margin="dense"
                    variant="standard"
                    label="Segment name"
                    fullWidth
                    value={name}
                    onChange={(e) => {
                        setName(e.target.value);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            onRename(name.trim());
                        }
                    }}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    onClick={() => {
                        onRename(name.trim());
                    }}
                >
                    Rename
                </Button>
            </DialogActions>
        </Dialog>
    );
};

interface RoomRectangle {
    label: string;
    rect: {
        x1: number;
        y1: number;
        x2: number;
        y2: number;
    };
    /** Index in the stored restrictedZones array; undefined for a locally drawn (unsaved) area */
    storedZoneIndex?: number;
}

/**
 * Normalises two opposite corners into an axis-aligned rectangle.
 *
 * @param {PointCoordinates} a
 * @param {PointCoordinates} b
 * @returns {RoomRectangle["rect"]}
 */
const rectangleFromCorners = (a: PointCoordinates, b: PointCoordinates): RoomRectangle["rect"] => {
    return {
        x1: Math.min(a.x, b.x),
        y1: Math.min(a.y, b.y),
        x2: Math.max(a.x, b.x),
        y2: Math.max(a.y, b.y)
    };
};

/**
 * @param {string} prefix
 * @param {number} index
 * @param {RoomRectangle["rect"]} rect
 * @returns {string}
 */
const describeRectangle = (prefix: string, index: number, rect: RoomRectangle["rect"]): string => {
    const width = ((rect.x2 - rect.x1) / 100).toFixed(1);
    const height = ((rect.y2 - rect.y1) / 100).toFixed(1);

    return prefix + " " + (index + 1) + " - " + width + " x " + height + " m";
};

interface SegmentCreationDialogProps {
    open: boolean;
    onClose: () => void;
    rectangles: Array<RoomRectangle>;
    onCreateSegment: (name: string, rectangleIndex: number) => void;
}

const SEGMENT_NAME_MAX_LENGTH = 23;

const SegmentCreationDialog = (props: SegmentCreationDialogProps) => {
    const {open, onClose, rectangles, onCreateSegment} = props;
    const [name, setName] = React.useState("");
    const [rectangleIndex, setRectangleIndex] = React.useState(0);

    React.useEffect(() => {
        if (open) {
            setName("");
            setRectangleIndex(0);
        }
    }, [open]);

    const trimmedName = name.trim();
    const nameIsValid = trimmedName.length > 0 && trimmedName.length <= SEGMENT_NAME_MAX_LENGTH;
    const selectedRectangle = rectangles[rectangleIndex];

    return (
        <Dialog open={open} onClose={onClose} sx={{userSelect: "none"}}>
            <DialogTitle>Create Room</DialogTitle>
            <DialogContent>
                <DialogContentText>
                    Rooms are axis-aligned rectangles. Pick a no-go area - one which is already saved
                    or one you just drew - to turn it into a room.
                </DialogContentText>
                <FormControl component="fieldset">
                    <RadioGroup
                        value={rectangleIndex}
                        onChange={(e) => {
                            setRectangleIndex(Number(e.target.value));
                        }}
                    >
                        {rectangles.map((rectangle, index) => {
                            return (
                                <FormControlLabel
                                    key={rectangle.label}
                                    value={index}
                                    control={<Radio/>}
                                    label={rectangle.label}
                                />
                            );
                        })}
                    </RadioGroup>
                </FormControl>
                <TextField
                    autoFocus
                    margin="dense"
                    variant="standard"
                    label="Room name"
                    fullWidth
                    value={name}
                    inputProps={{
                        maxLength: SEGMENT_NAME_MAX_LENGTH
                    }}
                    onChange={(e) => {
                        setName(e.target.value);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            if (nameIsValid) {
                                onCreateSegment(trimmedName, rectangleIndex);
                            }
                        }
                    }}
                />
                {
                    selectedRectangle?.storedZoneIndex !== undefined &&
                    <DialogContentText style={{marginTop: "0.5rem"}}>
                        The saved no-go area is removed as soon as the room exists.
                    </DialogContentText>
                }
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    disabled={!nameIsValid || selectedRectangle === undefined}
                    onClick={() => {
                        onCreateSegment(trimmedName, rectangleIndex);
                    }}
                >
                    Create Room
                </Button>
            </DialogActions>
        </Dialog>
    );
};

interface SegmentMaterialDialogProps {
    open: boolean;
    onClose: () => void;
    name: string;
    currentMaterial: MapSegmentMaterial;
    onSubmit: (material: MapSegmentMaterial) => void;
}

const SegmentMaterialDialog = (props: SegmentMaterialDialogProps) => {
    const {open, onClose, name, currentMaterial, onSubmit} = props;
    const [material, setMaterial] = React.useState<MapSegmentMaterial>(currentMaterial);

    const {
        data: materialProperties,
        isPending: materialPropertiesPending
    } = useMapSegmentMaterialControlPropertiesQuery();

    React.useEffect(() => {
        if (open) {
            setMaterial(currentMaterial);
        }
    }, [open, currentMaterial]);

    const supportedMaterials = materialProperties?.supportedMaterials ?? [];

    return (
        <Dialog open={open} onClose={onClose} sx={{userSelect: "none"}}>
            <DialogTitle>Segment Material</DialogTitle>
            <DialogContent>
                <DialogContentText style={{marginBottom: "1rem"}}>
                    What material is the floor of segment &apos;{name}&apos; made of?
                </DialogContentText>
                {materialPropertiesPending ? (
                    <CircularProgress/>
                ) : (
                    <FormControl component="fieldset">
                        <RadioGroup
                            value={material}
                            onChange={(e) => setMaterial(e.target.value as MapSegmentMaterial)}
                        >
                            {supportedMaterials.map((material) => (
                                <FormControlLabel
                                    key={material}
                                    value={material}
                                    control={<Radio/>}
                                    label={getMaterialLabel(material)}
                                />
                            ))}
                        </RadioGroup>
                    </FormControl>
                )}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    onClick={() => {
                        onSubmit(material);
                    }}
                >
                    Save
                </Button>
            </DialogActions>
        </Dialog>
    );
};

interface SegmentActionsProperties {
    robotStatus: StatusState,
    selectedSegmentIds: string[];
    segmentNames: Record<string, string>;
    segmentMaterials: Record<string, RawMapLayerMaterial>;
    cuttingLine: CuttingLineClientStructure | undefined,
    noGoAreas: Array<NoGoAreaClientStructure>,

    convertPixelCoordinatesToCMSpace(coordinates: PointCoordinates): PointCoordinates

    supportedCapabilities: {
        [Capability.MapSegmentation]: boolean,
        [Capability.MapSegmentEdit]: boolean,
        [Capability.MapSegmentRename]: boolean,
        [Capability.MapSegmentMaterialControl]: boolean,
    }

    onAddCuttingLine(): void,

    onClear(): void;
}

const SegmentActions = (
    props: SegmentActionsProperties
): React.ReactElement => {
    const {
        selectedSegmentIds,
        segmentNames,
        segmentMaterials,
        cuttingLine,
        noGoAreas,
        convertPixelCoordinatesToCMSpace,
        supportedCapabilities,
        onAddCuttingLine,
        onClear
    } = props;

    const [renameDialogOpen, setRenameDialogOpen] = React.useState(false);
    const [materialDialogOpen, setMaterialDialogOpen] = React.useState(false);
    const [createRoomDialogOpen, setCreateRoomDialogOpen] = React.useState(false);
    const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false);

    const {
        mutate: joinSegments,
        isPending: joinSegmentsExecuting
    } = useJoinSegmentsMutation({
        onSuccess: onClear,
    });
    const {
        mutate: splitSegment,
        isPending: splitSegmentExecuting
    } = useSplitSegmentMutation({
        onSuccess: onClear,
    });
    const {
        mutate: renameSegment,
        isPending: renameSegmentExecuting
    } = useRenameSegmentMutation({
        onSuccess: onClear,
    });
    const {
        mutate: setSegmentMaterial,
        isPending: setSegmentMaterialExecuting
    } = useSetSegmentMaterialMutation({
        onSuccess: onClear,
    });
    const {
        mutate: createSegment,
        isPending: createSegmentExecuting
    } = useCreateSegmentMutation({
        onSuccess: onClear,
    });
    const {
        mutate: saveRestrictions
    } = useCombinedVirtualRestrictionsMutation();
    const {
        mutate: deleteSegment,
        isPending: deleteSegmentExecuting
    } = useDeleteSegmentMutation({
        onSuccess: onClear,
    });

    const {
        data: mapSegmentationProperties
    } = useMapSegmentationPropertiesQuery(supportedCapabilities[Capability.MapSegmentation]);

    const {
        data: storedRestrictions
    } = useCombinedVirtualRestrictionsQuery(supportedCapabilities[Capability.MapSegmentation]);

    /**
     * Everything which could become a room: the no-go areas which are already stored as virtual
     * restrictions (drawn and saved by the user) and the ones which are drawn but not saved yet.
     */
    const roomRectangles = React.useMemo<Array<RoomRectangle>>(() => {
        const rectangles: Array<RoomRectangle> = [];

        (storedRestrictions?.restrictedZones ?? []).forEach((zone, index) => {
            if (zone.type !== ValetudoRestrictedZoneType.Regular) {
                return;
            }

            const rect = rectangleFromCorners(zone.points.pA, zone.points.pC);

            rectangles.push({
                label: describeRectangle("Saved no-go area", index, rect),
                rect: rect,
                storedZoneIndex: index
            });
        });

        noGoAreas.forEach((noGoArea, index) => {
            const rect = rectangleFromCorners(
                convertPixelCoordinatesToCMSpace({
                    x: noGoArea.x0,
                    y: noGoArea.y0
                }),
                convertPixelCoordinatesToCMSpace({
                    x: noGoArea.x2,
                    y: noGoArea.y2
                })
            );

            rectangles.push({
                label: describeRectangle("Drawn area", index, rect),
                rect: rect
            });
        });

        return rectangles;
    }, [storedRestrictions, noGoAreas, convertPixelCoordinatesToCMSpace]);

    const canEdit = props.robotStatus.value === "docked";
    const segmentCreationSupported = mapSegmentationProperties?.segmentCreationSupport === true;

    const handleSplitClick = React.useCallback(() => {
        if (!canEdit || !cuttingLine || selectedSegmentIds.length !== 1) {
            return;
        }

        splitSegment({
            segment_id: selectedSegmentIds[0],
            pA: convertPixelCoordinatesToCMSpace({
                x: cuttingLine.x0,
                y: cuttingLine.y0
            }),
            pB: convertPixelCoordinatesToCMSpace({
                x: cuttingLine.x1,
                y: cuttingLine.y1
            })
        });
    }, [canEdit, splitSegment, selectedSegmentIds, cuttingLine, convertPixelCoordinatesToCMSpace]);

    const handleJoinClick = React.useCallback(() => {
        if (!canEdit || selectedSegmentIds.length !== 2) {
            return;
        }

        joinSegments({
            segment_a_id: selectedSegmentIds[0],
            segment_b_id: selectedSegmentIds[1],
        });
    }, [canEdit, joinSegments, selectedSegmentIds]);

    const handleRename = React.useCallback((name: string) => {
        if (!canEdit || selectedSegmentIds.length !== 1) {
            return;
        }
        setRenameDialogOpen(false);
        renameSegment({
            segment_id: selectedSegmentIds[0],
            name: name
        });
    }, [canEdit, renameSegment, selectedSegmentIds]);

    const handleSetMaterial = React.useCallback((material: MapSegmentMaterial) => {
        if (!canEdit || selectedSegmentIds.length !== 1) {
            return;
        }
        setMaterialDialogOpen(false);
        setSegmentMaterial({
            segment_id: selectedSegmentIds[0],
            material: material
        });
    }, [canEdit, setSegmentMaterial, selectedSegmentIds]);

    const handleCreateRoom = React.useCallback((name: string, rectangleIndex: number) => {
        const rectangle = roomRectangles[rectangleIndex];

        if (!canEdit || !rectangle) {
            return;
        }

        setCreateRoomDialogOpen(false);
        createSegment({
            name: name,
            rect: rectangle.rect
        }, {
            onSuccess: () => {
                if (rectangle.storedZoneIndex === undefined || !storedRestrictions) {
                    return;
                }

                // Convert: the no-go area becomes the room, so it must not stay a restriction
                saveRestrictions({
                    virtualWalls: storedRestrictions.virtualWalls,
                    restrictedZones: storedRestrictions.restrictedZones.filter((zone, index) => {
                        return index !== rectangle.storedZoneIndex;
                    })
                });
            }
        });
    }, [canEdit, createSegment, roomRectangles, saveRestrictions, storedRestrictions]);

    const handleDeleteClick = React.useCallback(() => {
        if (!canEdit || selectedSegmentIds.length !== 1) {
            return;
        }

        setDeleteDialogOpen(false);
        deleteSegment(selectedSegmentIds[0]);
    }, [canEdit, deleteSegment, selectedSegmentIds]);


    return (
        <Grid2 container spacing={1} direction="row-reverse" flexWrap="wrap-reverse">
            {
                segmentCreationSupported &&

                <Grid2>
                    <ActionButton
                        disabled={createSegmentExecuting || !canEdit || roomRectangles.length === 0}
                        color="inherit"
                        size="medium"
                        variant="extended"
                        onClick={() => {
                            setCreateRoomDialogOpen(true);
                        }}
                    >
                        <AddIcon style={{marginRight: "0.25rem", marginLeft: "-0.25rem"}}/>
                        Create Room
                        {createSegmentExecuting && (
                            <CircularProgress
                                color="inherit"
                                size={18}
                                style={{marginLeft: 10}}
                            />
                        )}
                    </ActionButton>
                </Grid2>
            }
            {
                supportedCapabilities[Capability.MapSegmentEdit] &&
                (selectedSegmentIds.length === 1 || selectedSegmentIds.length === 2) &&
                cuttingLine === undefined &&

                <Grid2>
                    <ActionButton
                        disabled={joinSegmentsExecuting || !canEdit || selectedSegmentIds.length !== 2}
                        color="inherit"
                        size="medium"
                        variant="extended"
                        onClick={handleJoinClick}
                    >
                        <JoinIcon style={{marginRight: "0.25rem", marginLeft: "-0.25rem"}}/>
                        Join {segmentNames[selectedSegmentIds[0]]} and {selectedSegmentIds.length === 2 ? segmentNames[selectedSegmentIds[1]] : "?"}
                        {joinSegmentsExecuting && (
                            <CircularProgress
                                color="inherit"
                                size={18}
                                style={{marginLeft: 10}}
                            />
                        )}
                    </ActionButton>
                </Grid2>
            }
            {
                supportedCapabilities[Capability.MapSegmentEdit] &&
                selectedSegmentIds.length === 1 &&
                cuttingLine !== undefined &&

                <Grid2>
                    <ActionButton
                        disabled={splitSegmentExecuting || !canEdit}
                        color="inherit"
                        size="medium"
                        variant="extended"
                        onClick={handleSplitClick}
                    >
                        <SplitIcon style={{marginRight: "0.25rem", marginLeft: "-0.25rem"}}/>
                        Split {segmentNames[selectedSegmentIds[0]]}
                        {splitSegmentExecuting && (
                            <CircularProgress
                                color="inherit"
                                size={18}
                                style={{marginLeft: 10}}
                            />
                        )}
                    </ActionButton>
                </Grid2>
            }
            {
                supportedCapabilities[Capability.MapSegmentRename] &&
                selectedSegmentIds.length === 1 &&
                cuttingLine === undefined &&

                <Grid2>
                    <ActionButton
                        disabled={renameSegmentExecuting || !canEdit}
                        color="inherit"
                        size="medium"
                        variant="extended"
                        onClick={() => {
                            setRenameDialogOpen(true);
                        }}
                    >
                        <RenameIcon style={{marginRight: "0.25rem", marginLeft: "-0.25rem"}}/>
                        Rename
                        {renameSegmentExecuting && (
                            <CircularProgress
                                color="inherit"
                                size={18}
                                style={{marginLeft: 10}}
                            />
                        )}
                    </ActionButton>
                </Grid2>
            }
            {
                segmentCreationSupported &&
                selectedSegmentIds.length === 1 &&
                cuttingLine === undefined &&

                <Grid2>
                    <ActionButton
                        disabled={deleteSegmentExecuting || !canEdit}
                        color="inherit"
                        size="medium"
                        variant="extended"
                        onClick={() => {
                            setDeleteDialogOpen(true);
                        }}
                    >
                        <DeleteIcon style={{marginRight: "0.25rem", marginLeft: "-0.25rem"}}/>
                        Delete
                        {deleteSegmentExecuting && (
                            <CircularProgress
                                color="inherit"
                                size={18}
                                style={{marginLeft: 10}}
                            />
                        )}
                    </ActionButton>
                </Grid2>
            }
            {
                supportedCapabilities[Capability.MapSegmentMaterialControl] &&
                selectedSegmentIds.length === 1 &&
                cuttingLine === undefined &&

                <Grid2>
                    <ActionButton
                        disabled={setSegmentMaterialExecuting || !canEdit}
                        color="inherit"
                        size="medium"
                        variant="extended"
                        onClick={() => {
                            setMaterialDialogOpen(true);
                        }}
                    >
                        <MaterialIcon style={{marginRight: "0.25rem", marginLeft: "-0.25rem"}}/>
                        Material
                        {setSegmentMaterialExecuting && (
                            <CircularProgress
                                color="inherit"
                                size={18}
                                style={{marginLeft: 10}}
                            />
                        )}
                    </ActionButton>
                </Grid2>
            }
            {
                supportedCapabilities[Capability.MapSegmentEdit] &&
                selectedSegmentIds.length === 1 &&
                cuttingLine === undefined &&

                <Grid2>
                    <ActionButton
                        disabled={joinSegmentsExecuting || !canEdit}
                        color="inherit"
                        size="medium"
                        variant="extended"
                        onClick={onAddCuttingLine}
                    >
                        <AddCuttingLineIcon style={{marginRight: "0.25rem", marginLeft: "-0.25rem"}}/>
                        Cutting Line
                    </ActionButton>
                </Grid2>
            }
            {
                (
                    selectedSegmentIds.length > 0 ||
                    cuttingLine !== undefined
                ) &&

                <Grid2>
                    <ActionButton
                        color="inherit"
                        size="medium"
                        variant="extended"
                        onClick={onClear}
                    >
                        <ClearIcon style={{marginRight: "0.25rem", marginLeft: "-0.25rem"}}/>
                        Clear
                    </ActionButton>
                </Grid2>
            }
            {
                !canEdit &&
                <Grid2>
                    <Typography variant="caption" color="textSecondary">
                        Editing segments requires the robot to be docked
                    </Typography>
                </Grid2>
            }
            {
                canEdit &&
                selectedSegmentIds.length === 0 &&
                <Grid2>
                    <Typography variant="caption" color="textSecondary" style={{fontSize: "1em"}}>
                        Please select a segment to start editing
                    </Typography>
                </Grid2>
            }
            {
                segmentCreationSupported &&

                <Grid2>
                    <Typography variant="caption" color="textSecondary" style={{fontSize: "1em"}}>
                        Rooms are axis-aligned rectangles. Draw one with the &quot;No-Go&quot; tool in the
                        virtual restrictions panel - saving it is optional - then press Create Room.
                    </Typography>
                </Grid2>
            }

            {
                supportedCapabilities[Capability.MapSegmentRename] && selectedSegmentIds.length === 1 &&
                <SegmentRenameDialog
                    open={renameDialogOpen}
                    onClose={() => setRenameDialogOpen(false)}
                    currentName={segmentNames[selectedSegmentIds[0]] ?? selectedSegmentIds[0]}
                    onRename={handleRename}
                />
            }

            {
                supportedCapabilities[Capability.MapSegmentMaterialControl] && selectedSegmentIds.length === 1 &&
                <SegmentMaterialDialog
                    open={materialDialogOpen}
                    onClose={() => setMaterialDialogOpen(false)}
                    name={segmentNames[selectedSegmentIds[0]] ?? selectedSegmentIds[0]}
                    currentMaterial={segmentMaterials[selectedSegmentIds[0]] as unknown as MapSegmentMaterial ?? MapSegmentMaterial.Generic}
                    onSubmit={handleSetMaterial}
                />
            }
            {
                segmentCreationSupported &&
                <SegmentCreationDialog
                    open={createRoomDialogOpen}
                    onClose={() => setCreateRoomDialogOpen(false)}
                    rectangles={roomRectangles}
                    onCreateSegment={handleCreateRoom}
                />
            }
            {
                segmentCreationSupported && selectedSegmentIds.length === 1 &&
                <Dialog
                    open={deleteDialogOpen}
                    onClose={() => setDeleteDialogOpen(false)}
                    sx={{userSelect: "none"}}
                >
                    <DialogTitle>Delete Segment</DialogTitle>
                    <DialogContent>
                        <DialogContentText>
                            Delete the room &quot;{segmentNames[selectedSegmentIds[0]] ?? selectedSegmentIds[0]}&quot;?
                            This cannot be undone.
                        </DialogContentText>
                    </DialogContent>
                    <DialogActions>
                        <Button onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
                        <Button color="error" onClick={handleDeleteClick}>Delete</Button>
                    </DialogActions>
                </Dialog>
            }
        </Grid2>
    );
};

export default SegmentActions;
