import mongoose from 'mongoose';

const apiUsageSchema = new mongoose.Schema({
  date: { type: String, required: true, unique: true, index: true },
  used: { type: Number, default: 0 },
  operations: { type: Map, of: Number, default: {} }
}, { timestamps: true });

export const ApiUsage = mongoose.model('ApiUsage', apiUsageSchema);
