function generateAccessToken() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let token = 'TK';
    for (let i = 0; i < 14; i++) {
        token += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    console.log(token);
    return token;
}

generateAccessToken();