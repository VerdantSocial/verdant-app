function verdantAuth() {
    return {
        userEmail: '',
        verificationCode: '',
        step: 'email',
        errorMessage: '',
        supabaseClient: null,
        leafText: '',
        replyingTo: null,
        characterLimit: 350,
        leafs: JSON.parse(localStorage.getItem('verdant_leafs')) || [
            { id: 1, username: 'seed_zero', displayName: 'System Node', content: 'Welcome to your secure terminal session on Verdant. Turn your first Leaf below!', timestamp: 'System Initialization', replies: [] }
        ],

        init() {
            // Live production keys linked directly to your dashboard
            this.supabaseClient = supabase.createClient(
                'https://supabase.co', 
                'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN6cGNqc2F1cmpkeWxmZGxub3d4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3ODEwNzQsImV4cCI6MjEwODM1NzA3NH0.J2AZ2cKLc-Vl1R_DDyIXOCeWRyaUi1SEyHaG7MfcF2M'
            );
            
            // Automatically log in active user sessions
            this.supabaseClient.auth.getSession().then(({ data }) => {
                if (data && data.session) { this.step = 'feed'; }
            });
        },
        
        async sendMagicCode() {
            this.errorMessage = '';
            if (!this.userEmail.trim()) { this.errorMessage = 'Please type a valid email.'; return; }
            
            const { data, error } = await this.supabaseClient.auth.signInWithOtp({
                email: this.userEmail
            });
            if (error) { this.errorMessage = error.message; } else { this.step = 'verify'; }
        },
        
        async confirmCode() {
            this.errorMessage = '';
            if (!this.verificationCode.trim()) { this.errorMessage = 'Please enter the 6-digit code.'; return; }
            
            const { data, error } = await this.supabaseClient.auth.verifyOtp({
                email: this.userEmail,
                token: this.verificationCode,
                type: 'email'
            });
            if (error) { this.errorMessage = error.message; } else { this.step = 'feed'; }
        },

        publishLeaf() {
            if (this.leafText.trim() === '' || (this.characterLimit - this.leafText.length) < 0) return;
            
            const newLeaf = {
                id: Date.now(),
                username: 'user_' + Math.floor(1000 + Math.random() * 9000),
                displayName: 'Verdant Node',
                content: this.leafText,
                timestamp: 'Just now',
                replies: []
            };

            if (this.replyingTo) {
                this.leafs = this.leafs.map(l => l.id === this.replyingTo ? { ...l, replies: [...l.replies, newLeaf] } : l);
                this.replyingTo = null;
            } else {
                this.leafs = [newLeaf, ...this.leafs];
            }

            localStorage.setItem('verdant_leafs', JSON.stringify(this.leafs));
            this.leafText = '';
        },

        logoutUser() {
            this.supabaseClient.auth.signOut();
            this.step = 'email';
            location.reload();
        }
    }
}
