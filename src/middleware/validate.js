import { validationResult } from 'express-validator';
import { AppError } from '../utils/AppError.js';

export function validate(req, _res, next) {
  const result = validationResult(req);
  if (result.isEmpty()) return next();
  const details = result.array({ onlyFirstError: true }).map(({ path, msg }) => ({ field: path, message: msg }));
  next(new AppError('Please check the highlighted fields.', 422, 'VALIDATION_ERROR', details));
}
