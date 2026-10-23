document.addEventListener('alpine:init', () => {
    Alpine.data('verdantAuth', () => ({
        userEmail: '',
        verificationCode: '',
        username: '',
        displayName: '',
        step: 'email',
        errorMessage: '',
        supabaseClient: null,
        currentUser: null,
        leafText: '',
        replyingTo: null,
        characterLimit: 350,
        isLoading: false,
        leafs: [],

        init() {
            this.configureSupabase();

            if (!this.supabaseClient) {
                this.errorMessage = 'Supabase is not configured.';
                return;
            }

            this.supabaseClient.auth.getSession().then(({ data }) => {
                if (data && data.session && data.session.user) {
                    this.currentUser = data.session.user;
                    this.userEmail = data.session.user.email || '';
                    this.loadProfileAndFeed();
                }
            });
        },

        configureSupabase() {
            const url = window.VERDANT_SUPABASE_URL || '';
            const anonKey = window.VERDANT_SUPABASE_ANON_KEY || '';

            if (!url || !anonKey) {
                this.errorMessage = 'Supabase URL and anon key are missing.';
                return;
            }

            this.supabaseClient = supabase.createClient(url, anonKey);
        },

        async sendMagicCode() {
            this.errorMessage = '';
            this.isLoading = true;

            if (!this.userEmail.trim()) {
                this.errorMessage = 'Please type a valid email.';
                this.isLoading = false;
                return;
            }

            const { error } = await this.supabaseClient.auth.signInWithOtp({
                email: this.userEmail.trim()
            });

            this.isLoading = false;

            if (error) {
                this.errorMessage = error.message;
                return;
            }

            this.step = 'verify';
        },

        async confirmCode() {
            this.errorMessage = '';
            this.isLoading = true;

            if (!this.verificationCode.trim()) {
                this.errorMessage = 'Please enter the 6-digit code.';
                this.isLoading = false;
                return;
            }

            const { data, error } = await this.supabaseClient.auth.verifyOtp({
                email: this.userEmail,
                token: this.verificationCode,
                type: 'email'
            });

            this.isLoading = false;

            if (error) {
                this.errorMessage = error.message;
                return;
            }

            this.currentUser = data.user;
            await this.loadProfileAndFeed();
        },

        async signInWithProvider(provider) {
            this.errorMessage = '';
            this.isLoading = true;

            const { error } = await this.supabaseClient.auth.signInWithOAuth({
                provider,
                options: {
                    redirectTo: 'https://verdantsocial.github.io/verdant-app/'
                }
            });

            this.isLoading = false;

            if (error) {
                this.errorMessage = error.message;
            }
        },

        async loadProfileAndFeed() {
            if (!this.currentUser) {
                return;
            }

            const { data: profile, error: profileError } = await this.supabaseClient
                .from('profiles')
                .select('*')
                .eq('id', this.currentUser.id)
                .maybeSingle();

            if (profileError) {
                this.errorMessage = profileError.message;
                return;
            }

            if (!profile) {
                this.username = '';
                this.displayName = '';
                this.step = 'profile';
                return;
            }

            this.username = profile.username || '';
            this.displayName = profile.display_name || '';
            this.step = 'feed';
            await this.loadLeafs();
        },

        async saveProfile() {
            this.errorMessage = '';
            this.isLoading = true;

            const cleanUsername = (this.username || '').trim();
            const cleanDisplayName = (this.displayName || '').trim();

            if (cleanUsername.length < 3) {
                this.errorMessage = 'Username must be at least 3 characters long.';
                this.isLoading = false;
                return;
            }

            if (!/^[a-zA-Z0-9_]+$/.test(cleanUsername)) {
                this.errorMessage = 'Username can only contain letters, numbers, and underscores.';
                this.isLoading = false;
                return;
            }

            if (!cleanDisplayName) {
                this.errorMessage = 'Please enter a display name.';
                this.isLoading = false;
                return;
            }

            if (!this.currentUser) {
                this.errorMessage = 'Please sign in before creating your profile.';
                this.isLoading = false;
                return;
            }

            const { error } = await this.supabaseClient
                .from('profiles')
                .upsert({
                    id: this.currentUser.id,
                    email: this.currentUser.email,
                    username: cleanUsername,
                    display_name: cleanDisplayName,
                    avatar_url: null
                }, { onConflict: 'id' });

            this.isLoading = false;

            if (error) {
                this.errorMessage = error.message;
                return;
            }

            this.username = cleanUsername;
            this.displayName = cleanDisplayName;
            this.step = 'feed';
            await this.loadLeafs();
        },

        async loadLeafs() {
            if (!this.supabaseClient) {
                return;
            }

            const leafQuery = await this.supabaseClient
                .from('leafs')
                .select(`
                    id,
                    content,
                    created_at,
                    parent_id,
                    author_id,
                    profiles!author_id(username, display_name)
                `)
                .order('created_at', { ascending: false });

            if (leafQuery.error) {
                this.errorMessage = leafQuery.error.message;
                return;
            }

            const likeQuery = await this.supabaseClient
                .from('leaf_likes')
                .select('leaf_id, user_id');

            if (likeQuery.error) {
                this.errorMessage = likeQuery.error.message;
                return;
            }

            const likeCounts = new Map();
            const likedLeafIds = new Set();

            for (const row of likeQuery.data || []) {
                likeCounts.set(row.leaf_id, (likeCounts.get(row.leaf_id) || 0) + 1);
                if (this.currentUser && row.user_id === this.currentUser.id) {
                    likedLeafIds.add(row.leaf_id);
                }
            }

            const mappedLeafs = (leafQuery.data || []).map((leaf) => {
                const profile = Array.isArray(leaf.profiles) ? leaf.profiles[0] : leaf.profiles || {};
                return {
                    id: leaf.id,
                    username: profile.username || 'verdant-user',
                    displayName: profile.display_name || 'Verdant User',
                    content: leaf.content,
                    timestamp: this.formatTimestamp(leaf.created_at),
                    parentId: leaf.parent_id,
                    likes: likeCounts.get(leaf.id) || 0,
                    liked: likedLeafIds.has(leaf.id),
                    replies: []
                };
            });

            const topLevelLeafs = [];
            const repliesByParent = new Map();

            for (const leaf of mappedLeafs) {
                if (leaf.parentId) {
                    if (!repliesByParent.has(leaf.parentId)) {
                        repliesByParent.set(leaf.parentId, []);
                    }
                    repliesByParent.get(leaf.parentId).push(leaf);
                } else {
                    topLevelLeafs.push(leaf);
                }
            }

            for (const leaf of topLevelLeafs) {
                leaf.replies = repliesByParent.get(leaf.id) || [];
            }

            this.leafs = topLevelLeafs;
        },

        async publishLeaf() {
            if (!this.currentUser) {
                this.errorMessage = 'Please sign in before posting.';
                return;
            }

            if (this.leafText.trim() === '' || (this.characterLimit - this.leafText.length) < 0) {
                return;
            }

            this.isLoading = true;

            const { error } = await this.supabaseClient
                .from('leafs')
                .insert({
                    author_id: this.currentUser.id,
                    content: this.leafText.trim(),
                    parent_id: this.replyingTo || null
                });

            this.isLoading = false;

            if (error) {
                this.errorMessage = error.message;
                return;
            }

            this.leafText = '';
            this.replyingTo = null;
            await this.loadLeafs();
        },

        async toggleLike(leafId) {
            if (!this.currentUser) {
                this.errorMessage = 'Please sign in before liking a leaf.';
                return;
            }

            const existingLike = await this.supabaseClient
                .from('leaf_likes')
                .select('id')
                .eq('leaf_id', leafId)
                .eq('user_id', this.currentUser.id)
                .maybeSingle();

            if (existingLike.error) {
                this.errorMessage = existingLike.error.message;
                return;
            }

            if (existingLike.data) {
                const { error } = await this.supabaseClient
                    .from('leaf_likes')
                    .delete()
                    .eq('id', existingLike.data.id);

                if (error) {
                    this.errorMessage = error.message;
                    return;
                }
            } else {
                const { error } = await this.supabaseClient
                    .from('leaf_likes')
                    .insert({
                        leaf_id: leafId,
                        user_id: this.currentUser.id
                    });

                if (error) {
                    this.errorMessage = error.message;
                    return;
                }
            }

            await this.loadLeafs();
        },

        async logoutUser() {
            if (this.supabaseClient) {
                await this.supabaseClient.auth.signOut();
            }
            this.currentUser = null;
            this.step = 'email';
            this.errorMessage = '';
            this.leafText = '';
            this.replyingTo = null;
            this.userEmail = '';
            this.verificationCode = '';
            this.username = '';
            this.displayName = '';
        },

        formatTimestamp(dateString) {
            return new Date(dateString).toLocaleString([], {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
            });
        }
    }));
});
