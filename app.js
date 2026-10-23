document.addEventListener('alpine:init', () => {
    Alpine.data('verdantAuth', () => ({
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
            this.configureSupabase();

            if (this.supabaseClient) {
                this.supabaseClient.auth.getSession().then(({ data }) => {
                    if (data && data.session) { this.step = 'feed'; }
                });
            }
        },

        configureSupabase() {
            const url = window.VERDANT_SUPABASE_URL || '';
            const anonKey = window.VERDANT_SUPABASE_ANON_KEY || '';

            if (!url || !anonKey) {
                this.errorMessage = 'Supabase is not configured. Set window.VERDANT_SUPABASE_URL and window.VERDANT_SUPABASE_ANON_KEY before loading app.js.';
                return;
            }

            this.supabaseClient = supabase.createClient(url, anonKey);
        },

        async sendMagicCode() {
            this.errorMessage = '';
            if (!this.supabaseClient) {
                this.errorMessage = 'Supabase is not configured. Add your project URL and anon key.';
                return;
            }
            if (!this.userEmail.trim()) { this.errorMessage = 'Please type a valid email.'; return; }

            const { data, error } = await this.supabaseClient.auth.signInWithOtp({
                email: this.userEmail
            });
            if (error) { this.errorMessage = error.message; } else { this.step = 'verify'; }
        },

        async confirmCode() {
            this.errorMessage = '';
            if (!this.supabaseClient) {
                this.errorMessage = 'Supabase is not configured. Add your project URL and anon key.';
                return;
            }
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
            if (this.supabaseClient) {
                this.supabaseClient.auth.signOut();
            }
            this.step = 'email';
            location.reload();
        }
    }));
});

