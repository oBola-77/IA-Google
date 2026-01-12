import postgres from 'postgres'
import 'dotenv/config' // Load environment variables from .env

const connectionString = process.env.DATABASE_URL
const sql = postgres(connectionString)

export default sql