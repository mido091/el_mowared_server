/**
 * @file pagination.js
 * @description Helper functions for standardized API pagination.
 */

/**
 * Calculates limit and offset based on request parameters.
 * 
 * @function paginate
 * @param {number|string} [page=1] - Requested page number.
 * @param {number|string} [limit=10] - Number of items per page.
 * @returns {{ limit: number, offset: number, page: number }} Standardized pagination parameters.
 */
export const paginate = (page = 1, limit = 10) => {
  const p = Math.max(1, parseInt(page));
  const l = Math.max(1, parseInt(limit));
  const offset = (p - 1) * l;
  
  return {
    limit: l,
    offset,
    page: p
  };
};

/**
 * Formats data and metadata into a standardized paginated response structure.
 * 
 * @function formatPaginatedResponse
 * @param {Array} data - The array of items for the current page.
 * @param {number} total - Total count of items in the database.
 * @param {number} page - Current page number.
 * @param {number} limit - Items per page.
 * @returns {Object} Formatted response including total pages and current metadata.
 */
export const formatPaginatedResponse = (data, total, page, limit) => {
  return {
    items: data,
    pagination: {
      totalItems: total,
      totalPages: Math.ceil(total / limit),
      currentPage: page,
      itemsPerPage: limit
    }
  };
};
