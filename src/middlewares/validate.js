import Joi from 'joi';
import { validationError, normalizeJoiDetails } from './errorHandler.js';

const buildValidatedObject = (source, schema, label) => {
  if (!schema) return source;

  const { value, error } = schema.validate(source, {
    abortEarly: false,
    stripUnknown: true,
    convert: true
  });

  if (!error) return value;

  throw validationError(undefined, normalizeJoiDetails(error.details), {
    details: { label }
  });
};

const applyValidatedObject = (target, validated) => {
  if (!target || typeof target !== 'object') {
    return validated;
  }

  for (const key of Object.keys(target)) {
    delete target[key];
  }

  Object.assign(target, validated);
  return target;
};

export const validate = ({ body, params, query } = {}) => (req, res, next) => {
  try {
    if (params) {
      const validatedParams = buildValidatedObject(req.params, params, 'params');
      applyValidatedObject(req.params, validatedParams);
    }
    if (query) {
      const validatedQuery = buildValidatedObject(req.query, query, 'query');
      applyValidatedObject(req.query, validatedQuery);
    }
    if (body) {
      const validatedBody = buildValidatedObject(req.body, body, 'body');
      applyValidatedObject(req.body, validatedBody);
    }
    next();
  } catch (error) {
    next(error);
  }
};

export { Joi };
