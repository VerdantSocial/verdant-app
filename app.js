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
        leafs: (() => {
            try {
                const stored = localStorage.getItem('verdant_leafs');
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (Array.isArray(parsed) && parsed.length) return parsed;
                }
            } catch (err) {
                console.warn('Failed to load saved leaves:', err);
            }

            return [
                { id: 1, username: 'seed_zero', displayName: 'System Node', content: 'Welcome to your secure terminal session on Verdant. Turn your first Leaf below!', timestamp: 'System Initialization', likes: 0, replies: [] }
            ];
        })(),

        createFallbackClient() {
            return {
                auth: {
                    async getSession() {
                        try {
                            const raw = localStorage.getItem('verdant_session');
                            const session = raw ? JSON.parse(raw) : null;
                            return {
                                data: { session: session && session.email ? { user: { email: session.email } } : null },
                                error: null
                            };
                        } catch (err) {
                            console.warn('Failed to read fallback session:', err);
                            return { data: { session: null }, error: null };
                        }
                    },

                    async signInWithOtp({ email }) {
                        const normalized = String(email || '').trim();
                        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
                            return { data: null, error: { message: 'Please type a valid email.' } };
                        }

                        localStorage.setItem('verdant_session', JSON.stringify({ email: normalized }));
                        return { data: { user: { email: normalized } }, error: null };
                    },

                    async verifyOtp({ email, token }) {
                        const normalizedEmail = String(email || '').trim();
                        const normalizedToken = String(token || '').trim();

                        if (!/^\d{6}$/.test(normalizedToken)) {
                            return { data: null, error: { message: 'Please enter a 6-digit code.' } };
                        }

                        const session = {
                            email: normalizedEmail,
                            user: { email: normalizedEmail },
                            expires_at: Date.now() + 60 * 60 * 1000
                        };

                        localStorage.setItem('verdant_session', JSON.stringify(session));
                        return { data: { session, user: session.user }, error: null };
                    },

                    async signOut() {
                        localStorage.removeItem('verdant_session');
                        return { error: null };
                    }
                }
            };
        },

        init() {
            const url = window.VERDANT_SUPABASE_URL || window.SUPABASE_URL || '';
            const anonKey = window.VERDANT_SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY || '';
            const hasValidSupabaseConfig = Boolean(url && anonKey && !url.includes('your-project') && !anonKey.includes('your-'));

            if (!hasValidSupabaseConfig) {
                this.supabaseClient = this.createFallbackClient();
                this.supabaseClient.auth.getSession().then(({ data, error }) => {
                    if (error) {
                        this.errorMessage = error.message;
                        return;
                    }

                    if (data && data.session) {
                        this.userEmail = data.session.user?.email || '';
                        this.step = 'feed';
                    }
                });
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
                    this.userEmail = data.session.user?.email || '';
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

            this.userEmail = data?.user?.email || this.userEmail;
            this.step = 'feed';
        },

        publishLeaf() {
            if (this.leafText.trim() === '' || (this.characterLimit - this.leafText.length) < 0) return;

            const newLeaf = {
                id: Date.now(),
                username: 'user_' + Math.floor(1000 + Math.random() * 9000),
                displayName: this.userEmail ? this.userEmail.split('@')[0] : 'Verdant Node',
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

        async logoutUser() {
            if (this.supabaseClient && this.supabaseClient.auth && this.supabaseClient.auth.signOut) {
                await this.supabaseClient.auth.signOut();
            }
            this.step = 'email';
            location.reload();
        }
    }));
});
