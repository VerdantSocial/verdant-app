document.addEventListener('alpine:init', () => {
  const safeStorage = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        if (raw === null) return fallback;
        return JSON.parse(raw);
      } catch (error) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        // no-op to preserve page function
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch (error) {
        // no-op to preserve page function
      }
    }
  };

  const makeAvatar = (seed, label = 'V') => {
    const value = String(seed || 'verdant').trim() || 'verdant';
    const initials = String(label || value).trim().slice(0, 2).toUpperCase() || 'V';
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120">
        <rect width="120" height="120" rx="30" fill="#0f1b12"/>
        <circle cx="60" cy="42" r="18" fill="#4ade80" opacity="0.95"/>
        <path d="M31 92c7-17 22-25 29-25s22 8 29 25" fill="#4ade80" opacity="0.9"/>
        <text x="60" y="68" text-anchor="middle" fill="#051008" font-size="25" font-family="Arial, sans-serif" font-weight="700">${initials}</text>
      </svg>
    `;
    return 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg);
  };

  const seedLeafs = [
    {
      id: 1,
      username: 'seed_zero',
      displayName: 'System Node',
      content: 'Welcome to Verdant. Start your own thread below.',
      timestamp: 'System Initialization',
      likes: 0,
      replies: []
    }
  ];

  const supabaseConfig = window.VERDANT_SUPABASE || {};
  const supabaseUrl = String(supabaseConfig.url || '').trim().replace(/\/+$/, '');
  const supabaseAnonKey = String(supabaseConfig.anonKey || '').trim();
  const supabaseSiteUrl = String(supabaseConfig.siteUrl || window.location.origin + window.location.pathname || 'https://verdantsocial.github.io/verdant-app').trim();
  const supabaseClient = (window.supabase && window.supabase.createClient && supabaseUrl && supabaseAnonKey)
    ? window.supabase.createClient(supabaseUrl, supabaseAnonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      })
    : null;

  function normalizeReplyShape(reply) {
    const profile = reply.profiles && reply.profiles.length ? reply.profiles[0] : null;
    return {
      id: reply.id,
      username: profile ? profile.username : reply.username || 'unknown',
      displayName: profile ? (profile.display_name || profile.username) : reply.display_name || 'Unknown',
      content: reply.content || '',
      avatarUrl: profile && profile.avatar_url ? profile.avatar_url : makeAvatar(profile ? (profile.display_name || profile.username) : 'verdant', (profile ? (profile.display_name || profile.username) : 'V').charAt(0).toUpperCase())
    };
  }

  function getCurrentUser() {
    return safeStorage.get('verdant_user', null);
  }

  function setLeafFeedFromStore() {
    const existing = safeStorage.get('verdant_leafs', seedLeafs);
    return Array.isArray(existing) ? existing : seedLeafs;
  }

  function formatDate(value) {
    if (!value) return 'Just now';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'Just now';
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  Alpine.data('verdantApp', () => ({
    step: getCurrentUser() ? 'feed' : 'signup',
    authMode: 'signup',
    form: {
      username: '',
      email: '',
      password: '',
      bio: '',
      pfpUrl: ''
    },
    errorMessage: '',
    leafText: '',
    replyText: '',
    replyingTo: null,
    characterLimit: 350,
    leafs: setLeafFeedFromStore(),
    isSubmitting: false,
    hasSupabase: Boolean(supabaseClient),
    connectionNotice: supabaseClient ? 'Connected to Supabase' : 'Set window.VERDANT_SUPABASE to enable live data sync',

    get currentUser() {
      return getCurrentUser() || {
        username: 'verdant_user',
        displayName: 'Verdant User',
        email: 'you@example.com',
        bio: '',
        pfpUrl: makeAvatar('verdant_user', 'V')
      };
    },

    get currentUserAvatar() {
      const user = this.currentUser;
      if (!user) return makeAvatar('verdant', 'V');
      const source = user.pfpUrl || user.avatarUrl || user.image || '';
      return source || makeAvatar(user.displayName || user.username || 'verdant', (user.displayName || user.username || 'V').charAt(0).toUpperCase());
    },

    get profilePreviewUrl() {
      const value = (this.form.pfpUrl || '').trim();
      if (value) return value;
      return makeAvatar(this.form.username || 'verdant', (this.form.username || 'V').charAt(0).toUpperCase());
    },

    async hydrateFromSession(user) {
      if (!user || !supabaseClient) {
        this.step = 'feed';
        return;
      }

      const { data: profileData, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        console.warn('Profile lookup failed', error);
      }

      const userRecord = {
        id: user.id,
        username: profileData?.username || user.user_metadata?.username || (user.email || 'verdant_user').split('@')[0],
        displayName: profileData?.display_name || user.user_metadata?.display_name || profileData?.username || (user.email || 'Verdant User').split('@')[0],
        email: profileData?.email || user.email || 'you@example.com',
        bio: profileData?.bio || '',
        pfpUrl: profileData?.avatar_url || makeAvatar(profileData?.display_name || profileData?.username || user.email || 'verdant', (profileData?.display_name || profileData?.username || 'V').charAt(0).toUpperCase())
      };

      safeStorage.set('verdant_user', userRecord);
      this.form.username = userRecord.username;
      this.form.email = userRecord.email;
      this.form.bio = userRecord.bio;
      this.form.pfpUrl = userRecord.pfpUrl;
      this.step = 'feed';
      await this.syncFeed();
    },

    async syncFeed() {
      if (!supabaseClient) {
        this.leafs = setLeafFeedFromStore();
        return;
      }

      try {
        const { data: leafRows, error: leafError } = await supabaseClient
          .from('leafs')
          .select(`
            id,
            author_id,
            content,
            created_at,
            parent_id,
            profiles:author_id (username, display_name, avatar_url),
            leaf_likes(count)
          `)
          .is('deleted_at', null)
          .eq('hidden_by_staff', false)
          .order('created_at', { ascending: false });

        if (leafError) throw leafError;

        const mapped = (leafRows || []).map((row) => {
          const profile = Array.isArray(row.profiles) ? row.profiles[0] : null;
          const likesCount = Array.isArray(row.leaf_likes) && row.leaf_likes.length ? Number(row.leaf_likes[0].count || 0) : 0;

          return {
            id: row.id,
            username: profile ? profile.username : 'unknown',
            displayName: profile ? (profile.display_name || profile.username) : 'Unknown',
            content: row.content,
            timestamp: formatDate(row.created_at),
            likes: likesCount,
            replies: (leafRows || [])
              .filter((reply) => reply.parent_id === row.id)
              .map((reply) => normalizeReplyShape({ ...reply, profiles: reply.profiles || [] })),
            authorId: row.author_id,
            avatarUrl: profile && profile.avatar_url ? profile.avatar_url : makeAvatar(profile ? (profile.display_name || profile.username) : 'verdant', (profile ? (profile.display_name || profile.username) : 'V').charAt(0).toUpperCase())
          };
        });

        this.leafs = mapped.filter((leaf) => leaf.id && (leaf.parent_id === null || leaf.parent_id === undefined));
        safeStorage.set('verdant_leafs', this.leafs);
      } catch (error) {
        console.error('Feed sync failed', error);
        this.leafs = setLeafFeedFromStore();
      }
    },

    toggleAuthMode(mode) {
      this.authMode = mode;
      this.errorMessage = '';
    },

    async createAccount() {
      const username = String(this.form.username || '').trim();
      const email = String(this.form.email || '').trim();
      const password = String(this.form.password || '').trim();

      if (!username || !email || !password) {
        this.errorMessage = 'Please fill in a username, email and password.';
        return;
      }

      if (password.length < 4) {
        this.errorMessage = 'Password must be at least 4 characters.';
        return;
      }

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        this.errorMessage = 'Please enter a valid email address.';
        return;
      }

      if (!supabaseClient) {
        this.errorMessage = 'Supabase is not configured. Set window.VERDANT_SUPABASE.url and window.VERDANT_SUPABASE.anonKey before running the app.';
        return;
      }

      this.isSubmitting = true;
      this.errorMessage = '';

      try {
        if (this.authMode === 'login') {
          const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
          if (error) throw error;
          if (data?.user) {
            await this.hydrateFromSession(data.user);
          }
          return;
        }

        const { data, error } = await supabaseClient.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: supabaseSiteUrl,
            data: {
              username,
              display_name: username
            }
          }
        });

        if (error) throw error;

        if (data?.user) {
          const profilePayload = {
            id: data.user.id,
            email: data.user.email,
            username,
            display_name: username,
            bio: String(this.form.bio || '').trim(),
            avatar_url: (String(this.form.pfpUrl || '').trim()) || makeAvatar(username, username.charAt(0).toUpperCase())
          };

          const { error: profileError } = await supabaseClient
            .from('profiles')
            .upsert(profilePayload, { onConflict: 'id' });

          if (profileError) {
            console.warn('Profile upsert failed', profileError);
          }

          if (data.session) {
            await this.hydrateFromSession(data.user);
            return;
          }

          this.errorMessage = 'Check your email to confirm your account before sign-in is available.';
          this.step = 'signup';
        }
      } catch (error) {
        console.error('Authentication failed', error);
        this.errorMessage = error?.message || 'Could not complete this request.';
      } finally {
        this.isSubmitting = false;
      }
    },

    async finishProfile() {
      const username = String(this.form.username || '').trim();
      const email = String(this.form.email || '').trim();
      const password = String(this.form.password || '').trim();

      if (!supabaseClient) {
        this.errorMessage = 'Supabase is not configured.';
        return;
      }

      if (!username || !email || !password) {
        this.errorMessage = 'Your account is missing required details.';
        return;
      }

      try {
        const { data: { user }, error: sessionError } = await supabaseClient.auth.getUser();
        if (sessionError || !user) {
          this.errorMessage = 'You need to sign in before saving a profile.';
          return;
        }

        const profilePayload = {
          id: user.id,
          email,
          username,
          display_name: username,
          bio: String(this.form.bio || '').trim(),
          avatar_url: (String(this.form.pfpUrl || '').trim()) || makeAvatar(username, username.charAt(0).toUpperCase())
        };

        const { error } = await supabaseClient
          .from('profiles')
          .upsert(profilePayload, { onConflict: 'id' });

        if (error) throw error;

        safeStorage.set('verdant_user', {
          id: user.id,
          username,
          displayName: username,
          email,
          bio: profilePayload.bio,
          pfpUrl: profilePayload.avatar_url
        });

        this.errorMessage = '';
        this.step = 'feed';
        await this.syncFeed();
      } catch (error) {
        console.error('Profile update failed', error);
        this.errorMessage = error?.message || 'Profile update failed.';
      }
    },

    startNewAccount() {
      safeStorage.remove('verdant_user');
      this.form = {
        username: '',
        email: '',
        password: '',
        bio: '',
        pfpUrl: ''
      };
      this.errorMessage = '';
      this.authMode = 'signup';
      this.step = 'signup';
    },

    async logoutUser() {
      if (supabaseClient) {
        await supabaseClient.auth.signOut();
      }
      safeStorage.remove('verdant_user');
      this.step = 'signup';
      this.form = {
        username: '',
        email: '',
        password: '',
        bio: '',
        pfpUrl: ''
      };
      this.errorMessage = '';
      this.authMode = 'signup';
    },

    async publishLeaf() {
      const user = this.currentUser;
      if (!user) return;

      const text = this.leafText.trim();
      if (!text || text.length > this.characterLimit) return;

      if (supabaseClient) {
        try {
          const { data: { user: activeUser }, error: userError } = await supabaseClient.auth.getUser();
          if (userError || !activeUser) {
            this.errorMessage = 'You must be signed in to post.';
            return;
          }

          const { error } = await supabaseClient.from('leafs').insert([
            {
              author_id: activeUser.id,
              content: text,
              hidden_by_staff: false
            }
          ]);

          if (error) throw error;
          this.leafText = '';
          this.errorMessage = '';
          await this.syncFeed();
          return;
        } catch (error) {
          console.error('Leaf publish failed', error);
          this.errorMessage = error?.message || 'Post failed.';
          return;
        }
      }

      const newLeaf = {
        id: Date.now(),
        username: user.username,
        displayName: user.displayName || user.username,
        content: text,
        timestamp: 'Just now',
        likes: 0,
        replies: []
      };

      this.leafs = [newLeaf, ...this.leafs];
      safeStorage.set('verdant_leafs', this.leafs);
      this.leafText = '';
    },

    async toggleLike(leafId) {
      if (supabaseClient) {
        try {
          const { data: { user } } = await supabaseClient.auth.getUser();
          if (!user) {
            this.errorMessage = 'Sign in to like a leaf.';
            return;
          }

          const { error } = await supabaseClient.from('leaf_likes').insert([
            { leaf_id: leafId, user_id: user.id }
          ]);

          if (error) {
            if (!String(error.message).toLowerCase().includes('duplicate')) {
              throw error;
            }
          }

          await this.syncFeed();
          return;
        } catch (error) {
          console.error('Like failed', error);
          this.errorMessage = error?.message || 'Could not save your like.';
          return;
        }
      }

      this.leafs = this.leafs.map((leaf) => {
        if (leaf.id === leafId) {
          return { ...leaf, likes: (leaf.likes || 0) + 1 };
        }
        return leaf;
      });
      safeStorage.set('verdant_leafs', this.leafs);
    },

    async publishReply(leafId) {
      const text = this.replyText.trim();
      if (!text) return;

      if (supabaseClient) {
        try {
          const { data: { user } } = await supabaseClient.auth.getUser();
          if (!user) {
            this.errorMessage = 'Sign in to reply.';
            return;
          }

          const { error } = await supabaseClient.from('leafs').insert([
            {
              author_id: user.id,
              parent_id: leafId,
              content: text,
              hidden_by_staff: false
            }
          ]);

          if (error) throw error;
          this.replyText = '';
          this.replyingTo = null;
          this.errorMessage = '';
          await this.syncFeed();
          return;
        } catch (error) {
          console.error('Reply failed', error);
          this.errorMessage = error?.message || 'Could not send the reply.';
          return;
        }
      }

      this.leafs = this.leafs.map((leaf) => {
        if (leaf.id !== leafId) return leaf;

        return {
          ...leaf,
          replies: [
            ...(leaf.replies || []),
            {
              id: Date.now(),
              username: this.currentUser.username,
              displayName: this.currentUser.displayName || this.currentUser.username,
              content: text
            }
          ]
        };
      });

      safeStorage.set('verdant_leafs', this.leafs);
      this.replyText = '';
      this.replyingTo = null;
    }
  }));

  if (supabaseClient) {
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        await this.hydrateFromSession(session.user);
      }

      if (event === 'SIGNED_OUT') {
        safeStorage.remove('verdant_user');
      }
    });

    supabaseClient.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        const app = Alpine.store('verdantApp');
        if (app && typeof app.hydrateFromSession === 'function') {
          app.hydrateFromSession(session.user);
        }
      }
    }).catch((error) => {
      console.warn('Session restore failed', error);
    });
  }
});
