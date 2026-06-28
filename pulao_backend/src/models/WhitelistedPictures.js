import mongoose from "mongoose";

const whitelistedPicturesSchema = new mongoose.Schema({
  person: { type: mongoose.Schema.Types.ObjectId, ref: "PersonInfo" },
  filepath: String,
  event: { type: mongoose.Schema.Types.ObjectId, ref: "Event", default: null },
});

whitelistedPicturesSchema.index({ event: 1, person: 1 });

export default mongoose.model("WhitelistedPictures", whitelistedPicturesSchema);
