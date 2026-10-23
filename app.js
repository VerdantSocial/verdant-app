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
            const url = window.VERDANT_SUPABASE_URL || window.SUPABASE_URL || '';
            const anonKey = window.VERDANT_SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY || '';

            if (!window.supabase || !url || !anonKey || url.includes('your-project') || anonKey.includes('your-')) {
                this.errorMessage = 'Supabase is not configured yet. Add your project URL and anon key before loading the app.';
                this.step = 'email';
                return;
            }

            try {
                this.supabaseClient = window.supabase.createClient(url, anonKey);
            } catch (err) {
                this.errorMessage = 'Supabase failed to initialize: ' + (err?.message || err);
                this.step = 'email';
                return;
            }

            this.supabaseClient.auth.getSession().then(({ data, error }) => {
                if (error) {
                    this.errorMessage = error.message;
                    return;
                }

                if (data && data.session) {
                    this.step = 'feed';
                }
            });
        },

        async sendMagicCode() {
            this.errorMessage = '';
            if (!this.userEmail.trim()) {
                this.errorMessage = 'Please type a valid email.';
                return;
            }

            if (!this.supabaseClient) {
                this.errorMessage = 'Supabase is not configured yet.';
                return;
            }

            const { data, error } = await this.supabaseClient.auth.signInWithOtp({
                email: this.userEmail
            });

            if (error) {
                this.errorMessage = error.message;
                return;
            }

            this.step = 'verify';
        },

        async confirmCode() {
            this.errorMessage = '';
            if (!this.verificationCode.trim()) {
                this.errorMessage = 'Please enter the 6-digit code.';
                return;
            }

            if (!this.supabaseClient) {
                this.errorMessage = 'Supabase is not configured yet.';
                return;
            }

            const { data, error } = await this.supabaseClient.auth.verifyOtp({
                email: this.userEmail,
                token: this.verificationCode,
                type: 'email'
            });

            if (error) {
                this.errorMessage = error.message;
                return;
            }

            this.step = 'feed';
        },

        publishLeaf() {
            if (this.leafText.trim() === '' || (this.characterLimit - this.leafText.length) < 0) return;

            const newLeaf = {
                id: Date.now(),
                username: 'user_' + Math.floor(1000 + Math.random() * 9000),
                displayName: 'Verdant Node',
                content: this.leafText,
                timestamp: 'Just now',
                likes: 0,
                replies: []
            };

            if (this.replyingTo) {
                this.leafs = this.leafs.map(l => l.id === this.replyingTo ? { ...l, replies: [...(l.replies || []), newLeaf] } : l);
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
