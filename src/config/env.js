import dotenv from 'dotenv';

dotenv.config();

const required = (name, { minLength = 1, disallow = [] } = {}) => {
  const value = process.env[name];
  if (!value || `${value}`.trim().length < minLength) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  if (disallow.includes(value)) {
    throw new Error(`Unsafe environment variable value detected for: ${name}`);
  }

  return value;
};

const parseFrontendOrigins = () => {
  const configured = process.env.FRONTEND_URL;
  if (!configured) {
    return ['http://localhost:5173', 'http://127.0.0.1:5173'];
  }

  return configured
    .split(',')
    .map((origin) => origin.trim())
    .map((origin) => origin.replace(/\/+$/, ''))
    .filter(Boolean);
};

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: Number(process.env.PORT || 5000),
  jwtSecret: required('JWT_SECRET', {
    minLength: 24,
    disallow: ['secret', 'changeme', 'jwt_secret']
  }),
  dbHost: required('DB_HOST'),
  dbUser: required('DB_USER'),
  dbPassword: required('DB_PASSWORD'),
  dbName: required('DB_NAME'),
  dbPort: Number(process.env.DB_PORT || 3306),
  cloudinaryName: required('CLD_NAME'),
  cloudinaryApiKey: required('API_KEY'),
  cloudinaryApiSecret: required('API_SECRET'),
  frontendOrigins: parseFrontendOrigins()
};

export const isProduction = env.nodeEnv === 'production';
export const isDevelopment = env.nodeEnv === 'development';
