import bcrypt from 'bcryptjs';
import crypto from 'crypto';

async function test() {
    const otp = '123456';
    const salt = await bcrypt.genSalt(10);
    const hash = await bcrypt.hash(otp, salt);
    
    console.log('OTP:', otp);
    console.log('Hash:', hash);
    
    const isMatch = await bcrypt.compare(otp, hash);
    console.log('Match result:', isMatch);
}

test();
