const mongoose = require("mongoose");

const ChatRoomSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true
    },
    name: {
      type: String,
      required: true
    },
    description: String,
    type: {
      type: String,
      enum: ["community", "support"],
      default: "community"
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("ChatRoom", ChatRoomSchema);
