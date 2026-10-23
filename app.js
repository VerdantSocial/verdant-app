document.addEventListener('alpine:init', () => {
    const createFallbackClient = () => ({
        auth: {
            async getSession() {
                try {
                    const raw = localStorage.getItem('verdant_session');
                    const session = raw ? JSON.parse(raw) : null;
                    return {
                        data: {
                            session: session && session.email ? { user: { email: session.email, id: session.user_id || 'local-user' } } : null
                        },
                        error: null
                    };
                } catch (err) {
                    console.warn('Could not read fallback session', err);
                    return { data: { session: null }, error: null };
                }
            },
            async signInWithOtp({ email }) {
                const normalized = String(email || '').trim();
                if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
                    return { data: null, error: { message: 'Please type a valid email.' } };
                }

                localStorage.setItem('verdant_session', JSON.stringify({ email: normalized, user_id: 'local-user' }));
                return { data: { user: { email: normalized, id: 'local-user' } }, error: null };
            },
            async verifyOtp({ email, token }) {
                const normalizedEmail = String(email || '').trim();
                const normalizedToken = String(token || '').trim();

                if (!/^\d{6}$/.test(normalizedToken)) {
                    return { data: null, error: { message: 'Please enter a 6-digit code.' } };
                }

                const session = { email: normalizedEmail, user: { email: normalizedEmail, id: 'local-user' } };
                localStorage.setItem('verdant_session', JSON.stringify({ email: normalizedEmail, user_id: 'local-user' }));
                return { data: { session }, error: null };
            },
            async signOut() {
                localStorage.removeItem('verdant_session');
                return { error: null };
            },
            async signInWithOAuth() {
                return { error: null };
            },
            onAuthStateChange() {
                return () => {};
            },
            async getUser() {
                const raw = localStorage.getItem('verdant_session');
                const session = raw ? JSON.parse(raw) : null;
                return { data: { user: session && session.email ? { id: session.user_id || 'local-user', email: session.email } : null }, error: null };
            }
        },
        from() {
            return {
                select() { return this; },
                eq() { return this; },
                order() { return this; },
                upsert() { return this; },
                update() { return this; },
                insert() { return this; },
                delete() { return this; },
                single() { return Promise.resolve({ data: null, error: null }); },
                maybeSingle() { return Promise.resolve({ data: null, error: null }); },
                then(resolve) { return Promise.resolve({ data: [], error: null }).then(resolve); }
            };
        }
    });

    Alpine.data('verdantAuth', () => ({
        userEmail: '',
        verificationCode: '',
        step: 'email',
        errorMessage: '',
        supabaseClient: null,
        leafText: '',
        replyingTo: null,
        characterLimit: 350,
        profile: null,
        profileDraft: {
            username: '',
            display_name: '',
            bio: ''
        },
        leafs: [],
        staffOpen: false,
        staffPassword: '',

        hashString(value) {
            let hash = 0;
            for (let i = 0; i < value.length; i++) {
                hash = (hash << 5) - hash + value.charCodeAt(i);
                hash |= 0;
            }
            return Math.abs(hash);
        },

        buildRetroAvatar(seed, text = 'V') {
            const palette = ['#10b981', '#34d399', '#fbbf24', '#f59e0b', '#fb7185', '#a78bfa', '#60a5fa', '#f472b6'];
            const seedValue = this.hashString(String(seed || 'verdant'));
            const base = palette[seedValue % palette.length];
            const accent = palette[(seedValue + 3) % palette.length];
            const badge = (text || 'V').trim().charAt(0).toUpperCase() || 'V';
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
        },

        profileAvatarUrl(profile = this.profile) {
            if (!profile) {
                return this.buildRetroAvatar('Verdant', 'V');
            }

            if (profile.avatar_url && profile.avatar_url.trim()) {
                return profile.avatar_url;
            }

            const seed = profile.display_name || profile.username || profile.email || 'Verdant';
            return this.buildRetroAvatar(seed, (profile.display_name || profile.username || 'V').charAt(0));
        },

        profileIsOfficial(profile = this.profile) {
            if (!profile) return false;
            return profile.badge_tier === 'official' || profile.role === 'admin' || String(profile.username || '').toLowerCase() === 'verdantofficial';
        },

        profileIsVerified(profile = this.profile) {
            if (!profile) return false;
            return profile.badge_tier === 'verified' || profile.badge_tier === 'official' || profile.role === 'staff' || profile.role === 'admin';
        },

        getBadgeText(profile = this.profile) {
            if (!profile) return '';
            if (profile.badge_tier === 'official') return 'Official Verdant';
            if (profile.badge_tier === 'verified' || profile.role === 'staff' || profile.role === 'admin') return 'Verified';
            return '';
        },

        getBadgeColorClass(profile = this.profile) {
            if (this.profileIsOfficial(profile)) return 'bg-amber-500/15 text-amber-300 border border-amber-400/30';
            if (this.profileIsVerified(profile)) return 'bg-emerald-500/15 text-emerald-300 border border-emerald-400/30';
            return 'hidden';
        },

        makeAvailableUsername(email) {
            const base = String(email || 'verdant').split('@')[0].replace(/[^a-z0-9_]/gi, '').toLowerCase() || 'verdant';
            return `${base}_${Math.random().toString(36).slice(2, 7)}`;
        },

        async init() {
            const url = window.VERDANT_SUPABASE_URL || window.SUPABASE_URL || '';
            const anonKey = window.VERDANT_SUPABASE_ANON_KEY || window.SUPABASE_ANON_KEY || '';
            const hasValidSupabaseConfig = Boolean(url && anonKey && !url.includes('your-project') && !anonKey.includes('your-'));

            if (!hasValidSupabaseConfig || !window.supabase) {
                this.supabaseClient = createFallbackClient();
                this.loadLocalFeed();
                this.supabaseClient.auth.getSession().then(({ data }) => {
                    if (data && data.session) {
                        this.userEmail = data.session.user?.email || '';
                        this.profile = {
                            id: data.session.user?.id || 'local-user',
                            username: 'verdant_local',
                            display_name: 'Local Verdant User',
                            bio: 'Working offline.',
                            email: this.userEmail,
                            badge_tier: 'verified',
                            role: 'user',
                            avatar_url: ''
                        };
                        this.profileDraft = {
                            username: this.profile.username,
                            display_name: this.profile.display_name,
                            bio: this.profile.bio
                        };
                        this.step = 'feed';
                    }
                });
                return;
            }

            this.supabaseClient = window.supabase.createClient(url, anonKey);

            this.supabaseClient.auth.onAuthStateChange((event, session) => {
                if (session) {
                    this.loadAuthedSession(session);
                } else {
                    this.step = 'email';
                    this.profile = null;
                    this.leafs = [];
                    this.errorMessage = '';
                }
            });

            this.supabaseClient.auth.getSession().then(({ data, error }) => {
                if (error) {
                    this.errorMessage = error.message;
                    return;
                }

                if (data && data.session) {
                    this.loadAuthedSession(data.session);
                }
            });
        },

        async loadAuthedSession(session) {
            if (!session || !session.user) return;
            this.userEmail = session.user.email || '';
            await this.loadProfile(session.user.id);
            this.step = this.needsProfileSetup() ? 'profile' : 'feed';
            await this.loadFeed();
        },

        needsProfileSetup() {
            if (!this.profile) return true;
            return !this.profile.username || !this.profile.display_name;
        },

        async loadProfile(userId) {
            if (!userId || !this.supabaseClient) return;

            try {
                const { data, error } = await this.supabaseClient
                    .from('profiles')
                    .select('*')
                    .eq('id', userId)
                    .maybeSingle();

                if (error && error.code !== 'PGRST116') {
                    throw error;
                }

                if (!data) {
                    const fallbackUsername = this.makeAvailableUsername(this.userEmail || 'verdant');
                    const payload = {
                        id: userId,
                        email: this.userEmail,
                        username: fallbackUsername,
                        display_name: (this.userEmail || 'Verdant User').split('@')[0],
                        bio: '',
                        avatar_url: '',
                        role: 'user',
                        badge_tier: 'none'
                    };

                    const { data: created, error: createError } = await this.supabaseClient
                        .from('profiles')
                        .upsert(payload, { onConflict: 'id' })
                        .select()
                        .single();

                    if (createError) throw createError;
                    this.profile = created;
                } else {
                    this.profile = data;
                }

                this.profileDraft = {
                    username: this.profile.username || '',
                    display_name: this.profile.display_name || '',
                    bio: this.profile.bio || ''
                };
            } catch (err) {
                console.warn('Profile load failed:', err);
                this.profile = {
                    id: userId,
                    email: this.userEmail,
                    username: this.makeAvailableUsername(this.userEmail || 'verdant'),
                    display_name: (this.userEmail || 'Verdant User').split('@')[0],
                    bio: '',
                    badge_tier: 'none',
                    role: 'user',
                    avatar_url: ''
                };
                this.profileDraft = {
                    username: this.profile.username,
                    display_name: this.profile.display_name,
                    bio: this.profile.bio || ''
                };
            }
        },

        async saveProfile() {
            if (!this.supabaseClient) {
                this.step = 'feed';
                return;
            }

            const username = String(this.profileDraft.username || '').trim();
            const displayName = String(this.profileDraft.display_name || '').trim();
            const bio = String(this.profileDraft.bio || '').trim();

            if (!username || !displayName) {
                this.errorMessage = 'Choose a username and display name before continuing.';
                return;
            }

            const payload = {
                id: this.profile?.id || (await this.supabaseClient.auth.getUser()).data.user?.id,
                email: this.userEmail,
                username,
                display_name: displayName,
                bio,
                avatar_url: this.profileAvatarUrl({
                    ...this.profile,
                    username,
                    display_name: displayName,
                    bio,
                    avatar_url: this.profile?.avatar_url || ''
                }),
                badge_tier: this.profile?.badge_tier || 'none',
                role: this.profile?.role || 'user'
            };

            const { data, error } = await this.supabaseClient
                .from('profiles')
                .upsert(payload, { onConflict: 'id' })
                .select()
                .single();

            if (error) {
                this.errorMessage = error.message || 'Could not save the profile.';
                return;
            }

            this.profile = data;
            this.errorMessage = '';
            this.step = 'feed';
            this.loadFeed();
        },

        async signInWithProvider(provider) {
            if (!this.supabaseClient) {
                this.errorMessage = 'Supabase is not configured yet.';
                return;
            }

            const { error } = await this.supabaseClient.auth.signInWithOAuth({
                provider,
                options: {
                    redirectTo: window.location.origin + window.location.pathname
                }
            });

            if (error) {
                this.errorMessage = error.message;
            }
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

            const { error } = await this.supabaseClient.auth.signInWithOtp({
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
            if (data && data.user) {
                this.loadProfile(data.user.id);
            }
            this.step = 'feed';
        },

        async loadFeed() {
            if (!this.supabaseClient) {
                this.loadLocalFeed();
                return;
            }

            try {
                const { data, error } = await this.supabaseClient
                    .from('leafs')
                    .select('id, content, created_at, parent_id, author_id, profiles:author_id (id, username, display_name, bio, avatar_url, badge_tier, role, email)')
                    .order('created_at', { ascending: false });

                if (error) throw error;

                const rows = Array.isArray(data) ? data : [];
                if (!rows.length) {
                    this.loadLocalFeed();
                    return;
                }

                const grouped = new Map();
                rows.forEach((row) => {
                    const profile = row.profiles || {};
                    const normalized = {
                        id: row.id,
                        content: row.content,
                        timestamp: this.formatTime(row.created_at),
                        parent_id: row.parent_id,
                        author: {
                            id: profile.id || row.author_id,
                            username: profile.username || 'verdant_user',
                            display_name: profile.display_name || 'Verdant User',
                            bio: profile.bio || '',
                            email: profile.email || '',
                            role: profile.role || 'user',
                            badge_tier: profile.badge_tier || 'none',
                            avatar_url: profile.avatar_url || this.buildRetroAvatar(profile.display_name || profile.username || 'Verdant')
                        },
                        likes: 0,
                        replies: []
                    };
                    if (!row.parent_id) {
                        grouped.set(row.id, normalized);
                    } else {
                        const parent = grouped.get(row.parent_id);
                        if (parent) {
                            parent.replies.push(normalized);
                        }
                    }
                });

                this.leafs = Array.from(grouped.values());
            } catch (err) {
                console.warn('Could not load feed from Supabase, using local data instead.', err);
                this.loadLocalFeed();
            }
        },

        loadLocalFeed() {
            try {
                const saved = JSON.parse(localStorage.getItem('verdant_leafs') || 'null');
                if (Array.isArray(saved) && saved.length) {
                    this.leafs = saved;
                    return;
                }
            } catch (err) {
                console.warn('Failed to parse cached leaves', err);
            }

            this.leafs = [{
                id: 1,
                username: 'seed_zero',
                displayName: 'System Node',
                author: {
                    id: 'seed-zero',
                    username: 'seed_zero',
                    display_name: 'System Node',
                    badge_tier: 'verified',
                    role: 'admin',
                    avatar_url: this.buildRetroAvatar('System Node', 'S')
                },
                content: 'Welcome to your secure terminal session on Verdant. Turn your first Leaf below!',
                timestamp: 'System Initialization',
                likes: 0,
                replies: []
            }];
            localStorage.setItem('verdant_leafs', JSON.stringify(this.leafs));
        },

        formatTime(value) {
            if (!value) return 'Just now';
            const date = new Date(value);
            if (Number.isNaN(date.getTime())) return 'Just now';
            return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
        },

        publishLeaf() {
            const content = this.leafText.trim();
            if (!content || content.length > this.characterLimit) return;

            const newLeaf = {
                id: Date.now(),
                username: this.profile?.username || 'verdant_user',
                displayName: this.profile?.display_name || 'Verdant User',
                author: {
                    id: this.profile?.id || 'local-user',
                    username: this.profile?.username || 'verdant_user',
                    display_name: this.profile?.display_name || 'Verdant User',
                    badge_tier: this.profile?.badge_tier || 'none',
                    role: this.profile?.role || 'user',
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

            localStorage.setItem('verdant_leafs', JSON.stringify(this.leafs));
            this.leafText = '';
        },

        toggleLike(leafId) {
            this.leafs = this.leafs.map((leaf) => {
                if (leaf.id === leafId) {
                    return { ...leaf, likes: (leaf.likes || 0) + 1 };
                }
                return leaf;
            });
            localStorage.setItem('verdant_leafs', JSON.stringify(this.leafs));
        },

        async logoutUser() {
            if (this.supabaseClient && this.supabaseClient.auth && this.supabaseClient.auth.signOut) {
                await this.supabaseClient.auth.signOut();
            }
            this.step = 'email';
            this.profile = null;
            this.userEmail = '';
            this.leafText = '';
            this.verificationCode = '';
            this.errorMessage = '';
            localStorage.removeItem('verdant_session');
        },

        toggleStaffPanel() {
            const pass = window.VERDANT_STAFF_PASSCODE || 'verdant';
            if (this.staffPassword === pass) {
                this.staffOpen = !this.staffOpen;
                this.staffPassword = '';
                return;
            }

            if (this.staffPassword && this.staffPassword !== pass) {
                this.errorMessage = 'Incorrect staff passcode.';
                return;
            }

            this.staffOpen = !this.staffOpen;
        },

        keydownHandler(event) {
            if (event.ctrlKey && event.shiftKey && event.altKey && event.key.toLowerCase() === 'v') {
                this.staffOpen = true;
                this.staffPassword = '';
            }
        }
    }));

    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey && event.shiftKey && event.altKey && event.key.toLowerCase() === 'v') {
            const app = Alpine.store('verdantAuth');
            if (app && typeof app.toggleStaffPanel === 'function') {
                app.toggleStaffPanel();
            }
        }
    });
});
