const CapabilityRouter = require("./CapabilityRouter");
const ValetudoMapSegment = require("../../entities/core/ValetudoMapSegment");

class MapSegmentationCapabilityRouter extends CapabilityRouter {
    initRoutes() {
        this.router.get("/", async (req, res) => {
            try {
                res.json(await this.capability.getSegments());
            } catch (e) {
                this.sendErrorResponse(req, res, e);
            }
        });

        this.router.put("/", this.validator, async (req, res) => {
            switch (req.body.action) {
                case "start_segment_action": {
                    if (Array.isArray(req.body.segment_ids)) {
                        try {
                            const options = {};

                            if (typeof req.body.iterations === "number") {
                                options.iterations = req.body.iterations;
                            }

                            if (req.body.customOrder === true) {
                                options.customOrder = true;
                            }

                            await this.capability.executeSegmentAction(req.body.segment_ids.map(sid => {
                                return new ValetudoMapSegment({
                                    id: sid
                                });
                            }), options);

                            res.sendStatus(200);
                        } catch (e) {
                            this.sendErrorResponse(req, res, e);
                        }
                    } else {
                        res.sendStatus(400);
                    }

                    break;
                }

                /**
                 * Optional action for robots which advertise segmentCreationSupport.
                 * Creates a new Valetudo-side segment from an axis-aligned rectangle in cm,
                 * e.g. a "room" on a robot whose firmware has no segment support at all.
                 */
                case "create_segment": {
                    if (
                        req.body.rect &&
                        ["x1", "y1", "x2", "y2"].every(key => typeof req.body.rect[key] === "number")
                    ) {
                        try {
                            res.json(await this.capability.createSegment({
                                x1: req.body.rect.x1,
                                y1: req.body.rect.y1,
                                x2: req.body.rect.x2,
                                y2: req.body.rect.y2
                            }, req.body.name));
                        } catch (e) {
                            this.sendErrorResponse(req, res, e);
                        }
                    } else {
                        res.sendStatus(400);
                    }

                    break;
                }

                default: {
                    res.sendStatus(400);
                }
            }
        });
    }
}

module.exports = MapSegmentationCapabilityRouter;
