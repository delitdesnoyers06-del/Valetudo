import {
    Capability,
    MapSegmentMaterial,
    RawMapLayerMaterial,
    StatusState,
    useCreateSegmentMutation,
    useJoinSegmentsMutation,
    useMapSegmentationPropertiesQuery,
    useMapSegmentMaterialControlPropertiesQuery,
    useRenameSegmentMutation,
    useSetSegmentMaterialMutation,
    useSplitSegmentMutation
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

interface SegmentCreationDialogProps {
    open: boolean;
    onClose: () => void;
    onCreateSegment: (name: string) => void;
}

const SEGMENT_NAME_MAX_LENGTH = 23;

const SegmentCreationDialog = (props: SegmentCreationDialogProps) => {
    const {open, onClose, onCreateSegment} = props;
    const [name, setName] = React.useState("");

    React.useEffect(() => {
        if (open) {
            setName("");
        }
    }, [open]);

    const trimmedName = name.trim();
    const nameIsValid = trimmedName.length > 0 && trimmedName.length <= SEGMENT_NAME_MAX_LENGTH;

    return (
        <Dialog open={open} onClose={onClose} sx={{userSelect: "none"}}>
            <DialogTitle>Create Room</DialogTitle>
            <DialogContent>
                <DialogContentText>
                    How should the new room be called?
                </DialogContentText>
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
                                onCreateSegment(trimmedName);
                            }
                        }
                    }}
                />
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button
                    disabled={!nameIsValid}
                    onClick={() => {
                        onCreateSegment(trimmedName);
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
        data: mapSegmentationProperties
    } = useMapSegmentationPropertiesQuery(supportedCapabilities[Capability.MapSegmentation]);

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

    const handleCreateRoom = React.useCallback((name: string) => {
        if (!canEdit || noGoAreas.length === 0) {
            return;
        }

        const zone = noGoAreas[noGoAreas.length - 1];
        const pA = convertPixelCoordinatesToCMSpace({
            x: zone.x0,
            y: zone.y0
        });
        const pC = convertPixelCoordinatesToCMSpace({
            x: zone.x2,
            y: zone.y2
        });

        setCreateRoomDialogOpen(false);
        createSegment({
            name: name,
            rect: {
                x1: Math.min(pA.x, pC.x),
                y1: Math.min(pA.y, pC.y),
                x2: Math.max(pA.x, pC.x),
                y2: Math.max(pA.y, pC.y)
            }
        });
    }, [canEdit, createSegment, convertPixelCoordinatesToCMSpace, noGoAreas]);


    return (
        <Grid2 container spacing={1} direction="row-reverse" flexWrap="wrap-reverse">
            {
                segmentCreationSupported &&

                <Grid2>
                    <ActionButton
                        disabled={createSegmentExecuting || !canEdit || noGoAreas.length === 0}
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
                        virtual restrictions panel, then press Create Room.
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
                    onCreateSegment={handleCreateRoom}
                />
            }
        </Grid2>
    );
};

export default SegmentActions;
