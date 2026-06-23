const mongoose = require("mongoose");

const ChatMessageSchema = new mongoose.Schema(
  {
    roomKey: {
      type: String,
      required: true,
      index: true
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    username: {
      type: String,
      required: true
    },
    text: {
      type: String,
      required: true
    },
    role: {
      type: String,
      enum: ["user", "assistant", "system"],
      default: "user"
    },
    meta: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("ChatMessage", ChatMessageSchema);
