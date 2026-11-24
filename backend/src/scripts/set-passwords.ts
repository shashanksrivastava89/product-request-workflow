import bcrypt from 'bcrypt';
import { db, User } from '../services/db.service';

/**
 * Script to set a dummy password for all existing users
 * This is useful when migrating existing users to a password-protected system
 */
async function setDummyPasswords() {
    console.log('🔐 Setting dummy passwords for all users...\n');

    const DUMMY_PASSWORD = 'acme123'; // Default password for all users
    const hashedPassword = await bcrypt.hash(DUMMY_PASSWORD, 10);

    // Get all users
    const users = db.findMany<User>('users');

    if (users.length === 0) {
        console.log('⚠️  No users found in database.');
        return;
    }

    console.log(`Found ${users.length} users. Updating passwords...\n`);

    let updatedCount = 0;
    for (const user of users) {
        // Update user password
        db.update<User>('users', user.id, {
            password: hashedPassword
        } as Partial<User>);

        console.log(`✅ Updated password for: ${user.name} (${user.email})`);
        updatedCount++;
    }

    console.log(`\n🎉 Successfully updated passwords for ${updatedCount} users!`);
    console.log(`\n📝 Login credentials:`);
    console.log(`   Email: [user's email]`);
    console.log(`   Password: ${DUMMY_PASSWORD}`);
    console.log(`\n⚠️  IMPORTANT: Users should change their passwords after first login!`);
}

// Run the script
setDummyPasswords()
    .then(() => {
        console.log('\n✨ Script completed successfully!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('\n❌ Error setting passwords:', error);
        process.exit(1);
    });
