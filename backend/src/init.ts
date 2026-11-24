import path from 'path';
import { seedDatabase } from './services/seed.service';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '..', '.env') });

async function init() {
    console.log('🚀 Initializing backend...');

    // Seed the database with sample data
    await seedDatabase();

    console.log('✅ Backend initialized successfully!');
    console.log('\nYou can now start the server with: npm run dev');
}

init().catch(console.error);
