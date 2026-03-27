import pool from '../config/db.js';
import logger from '../utils/logger.js';
import PendingRegistrationRepository from '../repositories/PendingRegistrationRepository.js';
import ProductRepository from '../repositories/ProductRepository.js';
import SalesReviewRepository from '../repositories/SalesReviewRepository.js';

let runtimeReadinessPromise = null;

export const ensureRuntimeReadiness = async () => {
  if (runtimeReadinessPromise) return runtimeReadinessPromise;

  runtimeReadinessPromise = (async () => {
    const connection = await pool.getConnection();

    try {
      await ProductRepository.initializeRuntimeSchema(connection);
      await PendingRegistrationRepository.initializeSchema(connection);
      await SalesReviewRepository.initializeSchema(connection);
      logger.info('Runtime database readiness checks completed');
    } finally {
      connection.release();
    }
  })().catch((error) => {
    runtimeReadinessPromise = null;
    logger.error('Runtime readiness checks failed', { message: error.message, stack: error.stack });
    throw error;
  });

  return runtimeReadinessPromise;
};

export const getRuntimeReadinessPromise = () => runtimeReadinessPromise;
