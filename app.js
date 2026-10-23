document.addEventListener('alpine:init', () => {
    const safeLocalStorage = {
        get(key, fallback = null) {
            try {
                const raw = localStorage.getItem(key);
                if (raw === null) return fallback;
                return JSON.parse(raw);
            } catch (err) {
                return fallback;
            }
        },
        set(key, value) {
            try {
                localStorage.setItem(key, JSON.stringify(value));
            } catch (err) {
                // no-op for restricted storage
            }
        },
        remove(key) {
            try {
                localStorage.removeItem(key);
            } catch (err) {
                // no-op for restricted storage
            }
        }
    };

    const fallbackAuth = {
        async getSession() {
            const session = safeLocalStorage.get('verdant_session', null);
            return {
                data: {
                    session: session && session.email ? { user: { id: session.user_id || 'local-user', email: session.email } } : null
                },
                error: null
            };
        },
        async signInWithOtp({ email }) {
            const normalized = String(email || '').trim();
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
                return { data: null, error: { message: 'Please type a valid email.' } };
            }
            safeLocalStorage.set('verdant_session', { email: normalized, user_id: 'local-user' });
            return { data: { user: { id: 'local-user', email: normalized } }, error: null };
        },
        async verifyOtp({ email, token }) {
            const normalizedEmail = String(email || '').trim();
            const normalizedToken = String(token || '').trim();
            if (!/^\d{6}$/.test(normalizedToken)) {
                return { data: null, error: { message: 'Please enter a 6-digit code.' } };
            }
            safeLocalStorage.set('verdant_session', { email: normalizedEmail, user_id: 'local-user' });
            return {
                data: {
                    user: { id: 'local-user', email: normalizedEmail },
                    session: { user: { id: 'local-user', email: normalizedEmail } }
                },
                error: null
            };
        },
        async signOut() {
            safeLocalStorage.remove('verdant_session');
            safeLocalStorage.remove('verdant_profile');
            return { error: null };
        },
        async signInWithOAuth() {
            return { data: null, error: null };
        },
        onAuthStateChange() {
            return () => {};
        },
        async getUser() {
            const session = safeLocalStorage.get('verdant_session', null);
            return {
                data: {
                    user: session && session.email ? { id: session.user_id || 'local-user', email: session.email } : null
                },
                error: null
            };
        }
    };

    const retroAvatar = (seed, label = 'V') => {
        const palette = ['#10b981', '#34d399', '#fbbf24', '#f59e0b', '#fb7185', '#a78bfa', '#60a5fa', '#f472b6'];
        let hash = 0;
        const value = String(seed || 'verdant');
        for (let i = 0; i < value.length; i++) {
            hash = (hash << 5) - hash + value.charCodeAt(i);
            hash |= 0;
        }
        const seedValue = Math.abs(hash);
        const base = palette[seedValue % palette.length];
        const accent = palette[(seedValue + 3) % palette.length];
        const badge = String(label || 'V').trim().charAt(0).toUpperCase() || 'V';
        const svg = `
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96" role="img" aria-label="Retro avatar">
                <defs>
                    <linearGradient id="g-${seedValue}" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stop-color="${base}"/>
                        <stop offset="100%" stop-color="${accent}"/>
                    </linearGradient>
                </defs>
                <rect width="96" height="96" rx="20" fill="url(#g-${seedValue})"/>
                <circle cx="48" cy="36" r="18" fill="rgba(255,255,255,0.18)"/>
                <path d="M24 74c6-14 18-22 24-22s18 8 24 22" fill="rgba(255,255,255,0.18)"/>
                <text x="48" y="54" font-size="32" font-family="Arial, sans-serif" text-anchor="middle" fill="#fff" font-weight="700">${badge}</text>
            </svg>
        `;
        return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
    };

    Alpine.data('verdantAuth', () => ({
        userEmail: '',
        verificationCode: '',
        step: 'email',
        errorMessage: '',
        supabaseClient: null,
        profile: null,
        profileDraft: { username: '', display_name: '', bio: '', avatar_url: '' },
        leafText: '',
        replyingTo: null,
        characterLimit: 350,
        leafs: [],
        staffOpen: false,
        staffPassword: '',
        verificationQueue: [],

        profileAvatarUrl(profileObj = this.profile) {
            if (!profileObj) return retroAvatar('Verdant', 'V');
            if (profileObj.avatar_url && String(profileObj.avatar_url).trim()) return profileObj.avatar_url;
            const seed = profileObj.display_name || profileObj.username || profileObj.email || 'Verdant';
            return retroAvatar(seed, (profileObj.display_name || profileObj.username || 'V').charAt(0).toUpperCase());
        },

        profileIsOfficial(profileObj = this.profile) {
            if (!profileObj) return false;
            return profileObj.badge_tier === 'official' || profileObj.role === 'admin' || String(profileObj.username || '').toLowerCase() === 'verdantofficial';
        },

        profileIsVerified(profileObj = this.profile) {
            if (!profileObj) return false;
            return profileObj.badge_tier === 'verified' || profileObj.badge_tier === 'official' || profileObj.role === 'staff' || profileObj.role === 'admin';
        },

        getBadgeText(profileObj = this.profile) {
            if (!profileObj) return '';
            if (profileObj.badge_tier === 'official' || profileObj.role === 'admin') return 'Official Verdant';
            if (profileObj.badge_tier === 'verified' || profileObj.role === 'staff') return 'Verified';
            return '';
        },

        getBadgeClass(profileObj = this.profile) {
            if (this.profileIsOfficial(profileObj)) return 'bg-amber-400/15 text-amber-200 border border-amber-300/40';
            if (this.profileIsVerified(profileObj)) return 'bg-emerald-500/15 text-emerald-200 border border-emerald-300/40';
            return 'hidden';
        },

        makeAvailableUsername(email) {
            const base = String(email || 'verdant').split('@')[0].replace(/[^a-z0-9_]/gi, '').toLowerCase() || 'verdant';
            return `${base}_${Math.random().toString(36).slice(2, 7)}`;
        },

        buildProfile(user, extras = {}) {
            const email = String((user && user.email) || this.userEmail || 'verdant@local').trim();
            return {
                id: (user && user.id) || 'local-user',
                email,
                username: extras.username || this.makeAvailableUsername(email),
                display_name: extras.display_name || (email.split('@')[0] || 'Verdant User'),
                bio: extras.bio || '',
                avatar_url: extras.avatar_url || '',
                role: extras.role || 'user',
                badge_tier: extras.badge_tier || 'none'
            };
        },

        saveLocalProfile(profileObj) {
            if (profileObj) {
                safeLocalStorage.set('verdant_profile', profileObj);
            }
        },

        init() {
            this.leafs = safeLocalStorage.get('verdant_leafs', [
                {
                    id: 1,
                    username: 'seed_zero',
                    displayName: 'System Node',
                    author: {
                        id: 'seed-zero',
                        username: 'seed_zero',
                        display_name: 'System Node',
                        badge_tier: 'verified',
                        role: 'admin',
                        avatar_url: retroAvatar('System Node', 'S')
                    },
                    content: 'Welcome to your secure terminal session on Verdant. Turn your first Leaf below!',
                    timestamp: 'System Initialization',
                    likes: 0,
                    replies: []
                }
            ]);

            const url = window.VERDANT_SUPABASE_URL || window.SUPABASE_URL || '';
            const anonKey = window.VERDANT_SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY || '';
            const hasSupabase = Boolean(window.supabase && url && anonKey && !url.includes('your-project') && !anonKey.includes('your-'));

            if (!hasSupabase) {
                this.supabaseClient = fallbackAuth;
                const stored = safeLocalStorage.get('verdant_session', null);
                const savedProfile = safeLocalStorage.get('verdant_profile', null);
                if (stored && stored.email) {
                    this.userEmail = stored.email;
                    this.profile = savedProfile || this.buildProfile({ id: stored.user_id || 'local-user', email: stored.email }, {
                        username: 'verdant_local',
                        display_name: 'Local Verdant User',
                        bio: 'Working offline.',
                        badge_tier: 'verified'
                    });
                    this.profileDraft = {
                        username: this.profile.username || '',
                        display_name: this.profile.display_name || '',
                        bio: this.profile.bio || '',
                        avatar_url: this.profile.avatar_url || ''
                    };
                    this.step = 'feed';
                }
                return;
            }

            try {
                this.supabaseClient = window.supabase.createClient(url, anonKey);
            } catch (err) {
                this.supabaseClient = fallbackAuth;
                this.errorMessage = 'Supabase setup failed; running in local mode.';
                return;
            }

            this.supabaseClient.auth.getSession().then(({ data, error }) => {
                if (error) {
                    this.errorMessage = error.message;
                    return;
                }
                if (data && data.session && data.session.user) {
                    this.userEmail = data.session.user.email || '';
                    this.profile = this.buildProfile(data.session.user, {
                        username: this.makeAvailableUsername(this.userEmail),
                        display_name: (this.userEmail || 'Verdant User').split('@')[0],
                        bio: '',
                        badge_tier: 'none'
                    });
                    this.profileDraft = {
                        username: this.profile.username || '',
                        display_name: this.profile.display_name || '',
                        bio: this.profile.bio || '',
                        avatar_url: this.profile.avatar_url || ''
                    };
                    this.step = 'feed';
                }
            });
        },

        async signInWithProvider(provider) {
            if (!this.supabaseClient) return;
            if (this.supabaseClient && this.supabaseClient.auth && this.supabaseClient.auth.signInWithOAuth) {
                const { error } = await this.supabaseClient.auth.signInWithOAuth({
                    provider,
                    options: {
                        redirectTo: window.location.origin + window.location.pathname
                    }
                });
                if (error) this.errorMessage = error.message;
            }
        },

        async sendMagicCode() {
            this.errorMessage = '';
            if (!this.userEmail.trim()) {
                this.errorMessage = 'Please type a valid email.';
                return;
            }
            if (!this.supabaseClient || !this.supabaseClient.auth || !this.supabaseClient.auth.signInWithOtp) {
                this.supabaseClient = fallbackAuth;
            }
            const { error } = await this.supabaseClient.auth.signInWithOtp({ email: this.userEmail });
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
            if (!this.supabaseClient || !this.supabaseClient.auth || !this.supabaseClient.auth.verifyOtp) {
                this.supabaseClient = fallbackAuth;
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
            this.userEmail = (data && data.user && data.user.email) || this.userEmail;
            this.profile = this.buildProfile({ id: (data && data.user && data.user.id) || 'local-user', email: this.userEmail }, {
                username: this.makeAvailableUsername(this.userEmail),
                display_name: (this.userEmail || 'Verdant User').split('@')[0],
                bio: '',
                badge_tier: 'none'
            });
            this.profileDraft = {
                username: this.profile.username || '',
                display_name: this.profile.display_name || '',
                bio: this.profile.bio || '',
                avatar_url: this.profile.avatar_url || ''
            };
            this.step = 'profile';
        },

        async saveProfile() {
            const username = String(this.profileDraft.username || '').trim();
            const displayName = String(this.profileDraft.display_name || '').trim();
            const bio = String(this.profileDraft.bio || '').trim();
            const avatar = String(this.profileDraft.avatar_url || '').trim();

            if (!username || !displayName) {
                this.errorMessage = 'Choose a username and display name before continuing.';
                return;
            }

            this.profile = {
                ...(this.profile || {}),
                id: (this.profile && this.profile.id) || 'local-user',
                email: this.userEmail,
                username,
                display_name: displayName,
                bio,
                avatar_url: avatar || this.profileAvatarUrl({
                    ...this.profile,
                    username,
                    display_name: displayName,
                    bio,
                    avatar_url: avatar
                }),
                role: (this.profile && this.profile.role) || 'user',
                badge_tier: (this.profile && this.profile.badge_tier) || 'none'
            };

            this.saveLocalProfile(this.profile);
            this.errorMessage = '';
            this.step = 'feed';
        },

        publishLeaf() {
            const content = this.leafText.trim();
            if (!content || content.length > this.characterLimit) return;

            const newLeaf = {
                id: Date.now(),
                username: (this.profile && this.profile.username) || 'verdant_user',
                displayName: (this.profile && this.profile.display_name) || 'Verdant User',
                author: {
                    id: (this.profile && this.profile.id) || 'local-user',
                    username: (this.profile && this.profile.username) || 'verdant_user',
                    display_name: (this.profile && this.profile.display_name) || 'Verdant User',
                    bio: (this.profile && this.profile.bio) || '',
                    badge_tier: (this.profile && this.profile.badge_tier) || 'none',
                    role: (this.profile && this.profile.role) || 'user',
                    avatar_url: this.profileAvatarUrl(this.profile)
                },
                content,
                timestamp: 'Just now',
                likes: 0,
                replies: []
            };

            if (this.replyingTo) {
                this.leafs = this.leafs.map((leaf) => {
                    if (leaf.id === this.replyingTo) {
                        return { ...leaf, replies: [...(leaf.replies || []), newLeaf] };
                    }
                    return leaf;
                });
                this.replyingTo = null;
            } else {
                this.leafs = [newLeaf, ...this.leafs];
            }

            safeLocalStorage.set('verdant_leafs', this.leafs);
            this.leafText = '';
        },

        toggleLike(leafId) {
            this.leafs = this.leafs.map((leaf) => {
                if (leaf.id === leafId) {
                    return { ...leaf, likes: (leaf.likes || 0) + 1 };
                }
                return leaf;
            });
            safeLocalStorage.set('verdant_leafs', this.leafs);
        },

        async logoutUser() {
            if (this.supabaseClient && this.supabaseClient.auth && this.supabaseClient.auth.signOut) {
                await this.supabaseClient.auth.signOut();
            }
            safeLocalStorage.remove('verdant_session');
            safeLocalStorage.remove('verdant_profile');
            this.profile = null;
            this.userEmail = '';
            this.verificationCode = '';
            this.leafText = '';
            this.errorMessage = '';
            this.step = 'email';
        },

        openStaffPanel() {
            this.staffOpen = true;
        },

        closeStaffPanel() {
            this.staffOpen = false;
            this.staffPassword = '';
        },

        authenticateStaff() {
            const pass = window.VERDANT_STAFF_PASSCODE || 'verdantadmin';
            if (this.staffPassword === pass) {
                this.staffOpen = true;
                this.staffPassword = '';
                this.verificationQueue = [
                    { id: 'demo-1', username: 'grower_garden', display_name: 'Grower Garden', badge_tier: 'none', role: 'user' },
                    { id: 'demo-2', username: 'verdantofficial', display_name: 'Verdant Official', badge_tier: 'official', role: 'admin' }
                ];
                return;
            }
            this.errorMessage = 'Incorrect staff passcode.';
        },

        setVerificationBadge(profileObj, tier) {
            if (!profileObj) return;
            const updated = {
                ...profileObj,
                badge_tier: tier,
                role: tier === 'official' ? 'admin' : profileObj.role || 'user'
            };
            this.verificationQueue = this.verificationQueue.filter((item) => item.id !== profileObj.id);
            if (this.profile && this.profile.id === updated.id) {
                this.profile = updated;
            }
        },

        avatarUrlForAuthor(authorObj) {
            if (!authorObj) return retroAvatar('Verdant', 'V');
            if (authorObj.avatar_url && String(authorObj.avatar_url).trim()) return authorObj.avatar_url;
            const seed = authorObj.display_name || authorObj.username || authorObj.email || 'Verdant';
            return retroAvatar(seed, String(authorObj.display_name || authorObj.username || 'V').charAt(0).toUpperCase());
        }
    }));

    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey && event.shiftKey && event.altKey && event.key.toLowerCase() === 'v') {
            const app = document.querySelector('[x-data="verdantAuth"]');
            if (!app) return;
            const alpineApp = Alpine.$data(app);
            if (alpineApp && typeof alpineApp.openStaffPanel === 'function') {
                alpineApp.openStaffPanel();
            }
        }
    });
});
