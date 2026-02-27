/**
 * Credentials Manager
 * Copyright (C) 2026 Jwadow
 * Licensed under AGPL-3.0
 * https://github.com/jwadow/credentials-manager
 */

// ============================================================================
// UTILITIES
// ============================================================================

const Utils = {
    /**
     * Generates UUID v4
     */
    generateUUID() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    },

    /**
     * Normalizes email (lowercase)
     */
    normalizeEmail(email) {
        return email.toLowerCase().trim();
    },

    /**
     * Normalizes TOTP (uppercase)
     */
    normalizeTOTP(totp) {
        return totp.toUpperCase().trim();
    },

    /**
     * Validates email
     */
    validateEmail(email) {
        return email.includes('@') && email.includes('.');
    },

    /**
     * Validates TOTP (32 characters, letters and numbers only)
     */
    validateTOTP(totp) {
        return totp.length === 32 && /^[A-Z0-9]+$/i.test(totp);
    },

    /**
     * Creates key for duplicate checking
     */
    createAccountKey(email, password, totp) {
        return `${this.normalizeEmail(email)}:${password}:${this.normalizeTOTP(totp)}`;
    },

    /**
     * Debounce function
     */
    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }
};

// ============================================================================
// STORAGE ABSTRACTION
// ============================================================================

const Storage = {
    /**
     * Gets data from localStorage
     */
    get(key, defaultValue = null) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (error) {
            console.error(`Error reading from localStorage: ${key}`, error);
            return defaultValue;
        }
    },

    /**
     * Saves data to localStorage
     */
    set(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error(`Error writing to localStorage: ${key}`, error);
            return false;
        }
    },

    /**
     * Removes data from localStorage
     */
    remove(key) {
        try {
            localStorage.removeItem(key);
            return true;
        } catch (error) {
            console.error(`Error removing from localStorage: ${key}`, error);
            return false;
        }
    },

    /**
     * Clears all localStorage
     */
    clear() {
        try {
            localStorage.clear();
            return true;
        } catch (error) {
            console.error('Error clearing localStorage', error);
            return false;
        }
    }
};

// ============================================================================
// STATE MANAGEMENT (Observer Pattern)
// ============================================================================

class StateManager {
    constructor() {
        this.observers = {};
    }

    /**
     * Subscribe to changes
     */
    subscribe(event, callback) {
        if (!this.observers[event]) {
            this.observers[event] = [];
        }
        this.observers[event].push(callback);
    }

    /**
     * Unsubscribe from changes
     */
    unsubscribe(event, callback) {
        if (!this.observers[event]) return;
        this.observers[event] = this.observers[event].filter(cb => cb !== callback);
    }

    /**
     * Notify subscribers
     */
    notify(event, data) {
        if (!this.observers[event]) return;
        this.observers[event].forEach(callback => callback(data));
    }
}

// ============================================================================
// DATA STORE (Single Source of Truth)
// ============================================================================

class DataStore {
    constructor() {
        this.state = new StateManager();
        this.data = {
            accounts: [],
            tags: [],
            settings: {
                theme: 'dark',
                compactMode: false,
                defaultDelimiter: '|'
            }
        };
        this.load();
        
        // Auto-save with debounce
        this.autoSave = Utils.debounce(() => this.save(), 500);
    }

    /**
     * Loads data from localStorage
     */
    load() {
        const savedData = Storage.get('credentialsManagerData');
        if (savedData) {
            this.data = { ...this.data, ...savedData };
        }
        
        // Load old data for backward compatibility
        const oldCompletedAccounts = Storage.get('completedAccounts', []);
        if (oldCompletedAccounts.length > 0 && this.data.accounts.length > 0) {
            this.data.accounts.forEach(acc => {
                if (oldCompletedAccounts.includes(acc.email)) {
                    acc.completed = true;
                }
            });
        }

        // Migration: add order for existing accounts
        this.data.accounts.forEach((acc, index) => {
            if (acc.order === undefined) {
                acc.order = index;
            }
        });
    }

    /**
     * Saves data to localStorage
     */
    save() {
        Storage.set('credentialsManagerData', this.data);
        this.state.notify('dataSaved', { timestamp: Date.now() });
    }

    // ========================================================================
    // ACCOUNTS MANAGEMENT
    // ========================================================================

    /**
     * Gets all accounts
     */
    getAccounts() {
        return this.data.accounts;
    }

    /**
     * Gets account by ID
     */
    getAccount(id) {
        return this.data.accounts.find(acc => acc.id === id);
    }

    /**
     * Adds new account
     */
    addAccount(accountData) {
        const account = {
            id: Utils.generateUUID(),
            email: Utils.normalizeEmail(accountData.email),
            password: accountData.password,
            totp: accountData.totp ? Utils.normalizeTOTP(accountData.totp) : '', // TOTP is optional
            extras: accountData.extras || [],
            tags: accountData.tags || [],
            completed: false,
            favorite: false,
            addedAt: Date.now(),
            lastUsed: null,
            order: this.data.accounts.length // Order for drag & drop
        };

        this.data.accounts.push(account);
        this.autoSave();
        this.state.notify('accountAdded', account);
        return account;
    }

    /**
     * Updates account
     */
    updateAccount(id, updates) {
        const index = this.data.accounts.findIndex(acc => acc.id === id);
        if (index === -1) return false;

        // Normalize email and totp if they are being updated
        if (updates.email) {
            updates.email = Utils.normalizeEmail(updates.email);
        }
        if (updates.totp !== undefined) {
            // If totp is provided, normalize it (can be empty string)
            updates.totp = updates.totp ? Utils.normalizeTOTP(updates.totp) : '';
        }

        this.data.accounts[index] = { ...this.data.accounts[index], ...updates };
        this.autoSave();
        this.state.notify('accountUpdated', this.data.accounts[index]);
        return true;
    }

    /**
     * Deletes account
     */
    deleteAccount(id) {
        const index = this.data.accounts.findIndex(acc => acc.id === id);
        if (index === -1) return false;

        const deleted = this.data.accounts.splice(index, 1)[0];
        this.autoSave();
        this.state.notify('accountDeleted', deleted);
        return true;
    }

    /**
     * Toggles account completion status
     */
    toggleAccountCompleted(id) {
        const account = this.getAccount(id);
        if (!account) return false;

        account.completed = !account.completed;
        this.autoSave();
        this.state.notify('accountUpdated', account);
        return true;
    }

    /**
     * Toggles favorite
     */
    toggleAccountFavorite(id) {
        const account = this.getAccount(id);
        if (!account) return false;

        account.favorite = !account.favorite;
        this.autoSave();
        this.state.notify('accountUpdated', account);
        return true;
    }

    /**
     * Updates last used time
     */
    updateLastUsed(id) {
        const account = this.getAccount(id);
        if (!account) return false;

        account.lastUsed = Date.now();
        this.autoSave();
        return true;
    }

    // ========================================================================
    // TAGS MANAGEMENT
    // ========================================================================

    /**
     * Gets all tags
     */
    getTags() {
        return this.data.tags;
    }

    /**
     * Gets tag by ID
     */
    getTag(id) {
        return this.data.tags.find(tag => tag.id === id);
    }

    /**
     * Creates new tag
     */
    createTag(name, color = '#6f00ff') {
        const tag = {
            id: Utils.generateUUID(),
            name: name.trim(),
            color: color,
            createdAt: Date.now()
        };

        this.data.tags.push(tag);
        this.autoSave();
        this.state.notify('tagCreated', tag);
        return tag;
    }

    /**
     * Updates tag
     */
    updateTag(id, updates) {
        const index = this.data.tags.findIndex(tag => tag.id === id);
        if (index === -1) return false;

        this.data.tags[index] = { ...this.data.tags[index], ...updates };
        this.autoSave();
        this.state.notify('tagUpdated', this.data.tags[index]);
        return true;
    }

    /**
     * Deletes tag
     */
    deleteTag(id) {
        const index = this.data.tags.findIndex(tag => tag.id === id);
        if (index === -1) return false;

        // Remove tag from all accounts
        this.data.accounts.forEach(acc => {
            acc.tags = acc.tags.filter(tagId => tagId !== id);
        });

        const deleted = this.data.tags.splice(index, 1)[0];
        this.autoSave();
        this.state.notify('tagDeleted', deleted);
        return true;
    }

    /**
     * Adds tag to account
     */
    addTagToAccount(accountId, tagId) {
        const account = this.getAccount(accountId);
        if (!account) return false;

        if (!account.tags.includes(tagId)) {
            account.tags.push(tagId);
            this.autoSave();
            this.state.notify('accountUpdated', account);
        }
        return true;
    }

    /**
     * Removes tag from account
     */
    removeTagFromAccount(accountId, tagId) {
        const account = this.getAccount(accountId);
        if (!account) return false;

        account.tags = account.tags.filter(id => id !== tagId);
        this.autoSave();
        this.state.notify('accountUpdated', account);
        return true;
    }

    /**
     * Updates account order after drag & drop
     */
    reorderAccounts(accountId, newOrder) {
        const account = this.getAccount(accountId);
        if (!account) return false;

        const oldOrder = account.order;
        account.order = newOrder;

        // Shift other accounts
        this.data.accounts.forEach(acc => {
            if (acc.id === accountId) return;
            
            if (oldOrder < newOrder) {
                // Moving down
                if (acc.order > oldOrder && acc.order <= newOrder) {
                    acc.order--;
                }
            } else {
                // Moving up
                if (acc.order >= newOrder && acc.order < oldOrder) {
                    acc.order++;
                }
            }
        });

        this.autoSave();
        this.state.notify('accountsReordered', { accountId, newOrder });
        return true;
    }

    /**
     * Gets accounts sorted by order
     */
    getAccountsSorted() {
        return [...this.data.accounts].sort((a, b) => (a.order || 0) - (b.order || 0));
    }

    // ========================================================================
    // IMPORT/EXPORT
    // ========================================================================

    /**
     * Imports accounts from file with smart merging
     * Duplicate logic: comparison by email+password (without TOTP)
     * TOTP loss protection: don't replace account with TOTP with account without TOTP
     */
    importAccounts(accounts) {
        const stats = { added: 0, updated: 0, skipped: 0 };

        accounts.forEach(newAcc => {
            // Search for duplicate by email+password only (without TOTP)
            const existing = this.data.accounts.find(acc =>
                Utils.normalizeEmail(acc.email) === Utils.normalizeEmail(newAcc.email) &&
                acc.password === newAcc.password
            );

            if (existing) {
                const existingHasTOTP = existing.totp && existing.totp.trim();
                const newHasTOTP = newAcc.totp && newAcc.totp.trim();
                
                if (existingHasTOTP && !newHasTOTP) {
                    // TOTP loss protection: don't replace account with TOTP with account without TOTP
                    stats.skipped++;
                } else if (!existingHasTOTP && newHasTOTP) {
                    // Add TOTP to existing account
                    existing.totp = newAcc.totp;
                    // Merge extras
                    let updated = false;
                    newAcc.extras.forEach(extra => {
                        if (!existing.extras.includes(extra)) {
                            existing.extras.push(extra);
                            updated = true;
                        }
                    });
                    stats.updated++;
                    this.state.notify('accountUpdated', existing);
                } else if (existingHasTOTP && newHasTOTP) {
                    if (existing.totp === newAcc.totp) {
                        // Same TOTP - merge extras
                        let updated = false;
                        newAcc.extras.forEach(extra => {
                            if (!existing.extras.includes(extra)) {
                                existing.extras.push(extra);
                                updated = true;
                            }
                        });
                        if (updated) {
                            stats.updated++;
                            this.state.notify('accountUpdated', existing);
                        } else {
                            stats.skipped++;
                        }
                    } else {
                        // Different TOTP - these are different accounts, add new one
                        this.addAccount(newAcc);
                        stats.added++;
                    }
                } else {
                    // Both without TOTP - merge extras
                    let updated = false;
                    newAcc.extras.forEach(extra => {
                        if (!existing.extras.includes(extra)) {
                            existing.extras.push(extra);
                            updated = true;
                        }
                    });
                    if (updated) {
                        stats.updated++;
                        this.state.notify('accountUpdated', existing);
                    } else {
                        stats.skipped++;
                    }
                }
            } else {
                // New account - add it
                this.addAccount(newAcc);
                stats.added++;
            }
        });

        this.autoSave();
        this.state.notify('accountsImported', stats);
        return stats;
    }

    /**
     * Exports accounts
     */
    exportAccounts(options = {}) {
        const {
            accountIds = null, // null = all accounts
            format = 'txt', // 'txt' or 'json'
            delimiter = '|',
            fields = { email: true, password: true, totp: true, extras: true }
        } = options;

        let accounts = accountIds
            ? this.data.accounts.filter(acc => accountIds.includes(acc.id))
            : this.data.accounts;

        if (format === 'json') {
            return JSON.stringify({
                version: '1.0',
                exportDate: new Date().toISOString(),
                accounts: accounts,
                tags: this.data.tags
            }, null, 2);
        }

        // TXT format
        const lines = accounts.map(acc => {
            const parts = [];
            if (fields.email) parts.push(acc.email);
            if (fields.password) parts.push(acc.password);
            if (fields.totp) parts.push(acc.totp);
            if (fields.extras && acc.extras.length > 0) {
                parts.push(acc.extras.join(', '));
            }
            return parts.join(delimiter);
        });

        return lines.join('\n');
    }

    // ========================================================================
    // SEARCH & FILTER
    // ========================================================================

    /**
     * Search accounts
     */
    searchAccounts(query) {
        if (!query) return this.data.accounts;

        const lowerQuery = query.toLowerCase();
        return this.data.accounts.filter(acc => {
            return acc.email.toLowerCase().includes(lowerQuery) ||
                   acc.extras.some(extra => extra.toLowerCase().includes(lowerQuery)) ||
                   acc.tags.some(tagId => {
                       const tag = this.getTag(tagId);
                       return tag && tag.name.toLowerCase().includes(lowerQuery);
                   });
        });
    }

    /**
     * Filter by tags
     */
    filterByTags(tagIds) {
        if (!tagIds || tagIds.length === 0) return this.data.accounts;

        return this.data.accounts.filter(acc => 
            tagIds.every(tagId => acc.tags.includes(tagId))
        );
    }

    /**
     * Filter by status
     */
    filterByStatus(status) {
        switch (status) {
            case 'completed':
                return this.data.accounts.filter(acc => acc.completed);
            case 'active':
                return this.data.accounts.filter(acc => !acc.completed);
            case 'favorite':
                return this.data.accounts.filter(acc => acc.favorite);
            default:
                return this.data.accounts;
        }
    }

    // ========================================================================
    // SETTINGS
    // ========================================================================

    /**
     * Gets settings
     */
    getSettings() {
        return this.data.settings;
    }

    /**
     * Updates settings
     */
    updateSettings(updates) {
        this.data.settings = { ...this.data.settings, ...updates };
        this.autoSave();
        this.state.notify('settingsUpdated', this.data.settings);
    }

    /**
     * Clears all data
     */
    clearAllData() {
        this.data = {
            accounts: [],
            tags: [],
            settings: {
                theme: 'dark',
                compactMode: false,
                defaultDelimiter: '|'
            }
        };
        this.save();
        this.state.notify('dataCleared', {});
    }
}

// ============================================================================
// NOTIFICATION SYSTEM
// ============================================================================

class NotificationManager {
    constructor() {
        this.currentNotification = null;
    }

    /**
     * Shows notification
     */
    show(message, duration = 1500) {
        // If notification already exists, update text
        if (this.currentNotification) {
            this.currentNotification.textContent = message;
            clearTimeout(this.currentNotification.hideTimer);
            this.currentNotification.hideTimer = setTimeout(() => this.hide(), duration);
            return;
        }

        // Create new notification
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        document.body.appendChild(notification);
        this.currentNotification = notification;

        // Show animation
        setTimeout(() => notification.classList.add('show'), 50);

        // Auto-hide
        notification.hideTimer = setTimeout(() => this.hide(), duration);
    }

    /**
     * Hides notification
     */
    hide() {
        if (!this.currentNotification) return;

        this.currentNotification.classList.remove('show');
        setTimeout(() => {
            if (this.currentNotification && document.body.contains(this.currentNotification)) {
                document.body.removeChild(this.currentNotification);
            }
            this.currentNotification = null;
        }, 200);
    }
}

// ============================================================================
// MODAL COMPONENT (Reusable)
// ============================================================================

class Modal {
    constructor(options = {}) {
        this.title = options.title || '';
        this.content = options.content || '';
        this.onConfirm = options.onConfirm || null;
        this.onCancel = options.onCancel || null;
        this.confirmText = options.confirmText || 'OK';
        this.cancelText = options.cancelText || 'Cancel';
        this.element = null;
    }

    /**
     * Creates modal HTML
     */
    create() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-container">
                <div class="modal-header">
                    <h3 class="modal-title">${this.title}</h3>
                    <button class="modal-close" aria-label="Close">✕</button>
                </div>
                <div class="modal-body">
                    ${this.content}
                </div>
                <div class="modal-footer">
                    <button class="modal-btn modal-btn-confirm">${this.confirmText}</button>
                    <button class="modal-btn modal-btn-cancel">${this.cancelText}</button>
                </div>
            </div>
        `;

        this.element = modal;
        this.attachEvents();
        return modal;
    }

    /**
     * Attaches event handlers
     */
    attachEvents() {
        const closeBtn = this.element.querySelector('.modal-close');
        const cancelBtn = this.element.querySelector('.modal-btn-cancel');
        const confirmBtn = this.element.querySelector('.modal-btn-confirm');

        closeBtn.addEventListener('click', () => this.close());
        cancelBtn.addEventListener('click', () => this.cancel());
        confirmBtn.addEventListener('click', () => this.confirm());

        // Close on Esc
        this.escHandler = (e) => {
            if (e.key === 'Escape') this.cancel();
        };
        document.addEventListener('keydown', this.escHandler);
    }

    /**
     * Shows modal
     */
    show() {
        if (!this.element) this.create();
        document.body.appendChild(this.element);
        setTimeout(() => this.element.classList.add('show'), 10);
    }

    /**
     * Closes modal
     */
    close() {
        if (!this.element) return;

        this.element.classList.remove('show');
        setTimeout(() => {
            if (this.element && document.body.contains(this.element)) {
                document.body.removeChild(this.element);
            }
            document.removeEventListener('keydown', this.escHandler);
            this.element = null;
        }, 200);
    }

    /**
     * Confirm
     */
    confirm() {
        if (this.onConfirm) {
            const result = this.onConfirm();
            if (result !== false) this.close();
        } else {
            this.close();
        }
    }

    /**
     * Cancel
     */
    cancel() {
        if (this.onCancel) this.onCancel();
        this.close();
    }

    /**
     * Gets form values from modal
     */
    getFormData() {
        if (!this.element) return {};

        const form = this.element.querySelector('form');
        if (!form) return {};

        const formData = new FormData(form);
        const data = {};
        for (const [key, value] of formData.entries()) {
            data[key] = value;
        }
        return data;
    }
}

// ============================================================================
// TOTP GENERATION (Optimized with caching and memory management)
// ============================================================================

const TOTP = {
    cache: new Map(), // Cache: secret -> {code, timeWindow}
    MAX_CACHE_SIZE: 100, // Maximum cache size (memory leak protection)

    /**
     * Base32 decoding
     */
    base32Decode(encoded) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        let bits = 0;
        let value = 0;
        let output = new Uint8Array(Math.floor(encoded.length * 5 / 8));
        let index = 0;

        for (let i = 0; i < encoded.length; i++) {
            const char = encoded.charAt(i).toUpperCase();
            if (char === '=') break;
            const charIndex = alphabet.indexOf(char);
            if (charIndex === -1) throw new Error('Invalid base32 character');
            value = (value << 5) | charIndex;
            bits += 5;
            if (bits >= 8) {
                output[index++] = (value >>> (bits - 8)) & 255;
                bits -= 8;
            }
        }
        return output.slice(0, index);
    },

    /**
     * HMAC-SHA1
     */
    async hmacSha1(key, message) {
        const cryptoKey = await crypto.subtle.importKey(
            'raw',
            key,
            { name: 'HMAC', hash: 'SHA-1' },
            false,
            ['sign']
        );
        const signature = await crypto.subtle.sign('HMAC', cryptoKey, message);
        return new Uint8Array(signature);
    },

    /**
     * Gets current time window (30 seconds)
     */
    getCurrentTimeWindow() {
        return Math.floor(Date.now() / 1000 / 30);
    },

    /**
     * Generates TOTP code with caching
     */
    async generate(secret) {
        try {
            const currentWindow = this.getCurrentTimeWindow();
            
            // Check cache
            const cached = this.cache.get(secret);
            if (cached && cached.timeWindow === currentWindow) {
                return cached.code;
            }

            // Generate new code
            const key = this.base32Decode(secret);
            const timeBuffer = new ArrayBuffer(8);
            const timeView = new DataView(timeBuffer);
            timeView.setUint32(4, currentWindow, false);

            const hmac = await this.hmacSha1(key, new Uint8Array(timeBuffer));
            const offset = hmac[hmac.length - 1] & 0xf;
            const code = ((hmac[offset] & 0x7f) << 24) |
                        ((hmac[offset + 1] & 0xff) << 16) |
                        ((hmac[offset + 2] & 0xff) << 8) |
                        (hmac[offset + 3] & 0xff);
            const totpCode = (code % 1000000).toString().padStart(6, '0');

            // Save to cache with size check
            this.cache.set(secret, { code: totpCode, timeWindow: currentWindow });
            
            // If cache is too large - aggressively clean
            if (this.cache.size > this.MAX_CACHE_SIZE) {
                this.aggressiveCleanCache();
            }

            return totpCode;
        } catch (error) {
            console.error('Error generating TOTP:', error);
            return 'Error';
        }
    },

    /**
     * Cleans outdated entries from cache
     */
    cleanCache() {
        const currentWindow = this.getCurrentTimeWindow();
        for (const [secret, data] of this.cache.entries()) {
            if (data.timeWindow < currentWindow - 1) {
                this.cache.delete(secret);
            }
        }
    },

    /**
     * Aggressive cache cleanup when limit exceeded
     */
    aggressiveCleanCache() {
        const currentWindow = this.getCurrentTimeWindow();
        // Remove all entries except current window
        for (const [secret, data] of this.cache.entries()) {
            if (data.timeWindow !== currentWindow) {
                this.cache.delete(secret);
            }
        }
        
        // If still too many - clear completely
        if (this.cache.size > this.MAX_CACHE_SIZE) {
            this.cache.clear();
        }
    },

    /**
     * Full cache cleanup (for cleanup on unmount)
     */
    clearAll() {
        this.cache.clear();
    }
};

// ============================================================================
// CLIPBOARD MANAGER
// ============================================================================

const Clipboard = {
    /**
     * Copies text to clipboard
     */
    async copy(text, type = 'text') {
        try {
            await navigator.clipboard.writeText(text);
            let displayText = text;
            if (type === 'password' && text.length > 4) {
                const stars = '•'.repeat(text.length - 4);
                displayText = text.substring(0, 2) + stars + text.substring(text.length - 2);
            }
            return displayText;
        } catch (error) {
            console.error('Clipboard error:', error);
            // Fallback for old browsers
            const textArea = document.createElement('textarea');
            textArea.value = text;
            document.body.appendChild(textArea);
            textArea.select();
            document.execCommand('copy');
            document.body.removeChild(textArea);
            
            let displayText = text;
            if (type === 'password' && text.length > 4) {
                const stars = '•'.repeat(text.length - 4);
                displayText = text.substring(0, 2) + stars + text.substring(text.length - 2);
            }
            return displayText;
        }
    }
};

// ============================================================================
// FILE PARSER
// ============================================================================

const FileParser = {
    /**
     * Parses file content with custom delimiter and field mapping
     * @param {string} content - File content
     * @param {string} delimiter - Delimiter character
     * @param {object} fieldMapping - Which fields are present: { hasEmail: true, hasPassword: true, hasTOTP: true }
     */
    parse(content, delimiter, fieldMapping = { hasEmail: true, hasPassword: true, hasTOTP: true }) {
        const lines = content.split('\n');
        const accounts = [];
        const errors = [];

        // Minimum number of fields (email + password)
        const minFields = 2;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i].trim();
            
            // Skip empty lines and comments
            if (!line || line.startsWith('#')) continue;

            try {
                const parts = line.split(delimiter).map(p => p.trim());
                
                if (parts.length < minFields) {
                    errors.push({ line: i + 1, error: 'Not enough fields (need at least email and password)', content: line });
                    continue;
                }

                let email, password, totp, extras;

                // Parse fields based on fieldMapping
                if (fieldMapping.hasTOTP) {
                    // Format: email | password | totp | extras...
                    [email, password, totp, ...extras] = parts;
                    
                    // TOTP validation (only if field is not empty)
                    if (totp && !Utils.validateTOTP(totp)) {
                        errors.push({ line: i + 1, error: 'Invalid TOTP (must be 32 alphanumeric chars or empty)', content: line });
                        continue;
                    }
                } else {
                    // Format: email | password | extras...
                    [email, password, ...extras] = parts;
                    totp = ''; // TOTP is absent
                }

                // Email validation
                if (!Utils.validateEmail(email)) {
                    errors.push({ line: i + 1, error: 'Invalid email', content: line });
                    continue;
                }

                accounts.push({
                    email,
                    password,
                    totp: totp || '', // Empty string if no TOTP
                    extras: extras.filter(e => e)
                });
            } catch (error) {
                errors.push({ line: i + 1, error: error.message, content: line });
            }
        }

        return { accounts, errors };
    },

    /**
     * Detects delimiter from file preview
     */
    detectDelimiter(content) {
        const lines = content.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 3);
        if (lines.length === 0) return null;

        const delimiters = ['|', ':', ';', ';;;', ';;', '\t', ','];
        const scores = {};

        delimiters.forEach(delim => {
            let score = 0;
            lines.forEach(line => {
                const parts = line.split(delim);
                if (parts.length >= 3) score++;
            });
            scores[delim] = score;
        });

        const best = Object.entries(scores).sort((a, b) => b[1] - a[1])[0];
        return best && best[1] > 0 ? best[0] : null;
    }
};

// ============================================================================
// IMPORT MODAL
// ============================================================================

class ImportModal extends Modal {
    constructor() {
        super({
            title: 'Import File',
            confirmText: 'Import',
            cancelText: 'Cancel'
        });
        this.file = null;
        this.delimiter = '|';
        this.hasTOTP = true; // By default file contains TOTP
    }

    create() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-container">
                <div class="modal-header">
                    <h3 class="modal-title">Import File</h3>
                    <button class="modal-close" aria-label="Close">✕</button>
                </div>
                <div class="modal-body">
                    <form id="importForm">
                        <div class="form-group">
                            <label>File: <strong>${this.file ? this.file.name : 'None'}</strong></label>
                        </div>
                        
                        <div class="form-group">
                            <label for="delimiter">Delimiter:</label>
                            <input type="text" id="delimiter" name="delimiter" value="${this.delimiter}" maxlength="3" required>
                        </div>

                        <div class="form-group">
                            <label>Quick select:</label>
                            <div class="delimiter-buttons">
                                <button type="button" class="delim-btn" data-delim="|">|</button>
                                <button type="button" class="delim-btn" data-delim=":">:</button>
                                <button type="button" class="delim-btn" data-delim=";">;</button>
                                <button type="button" class="delim-btn" data-delim=";;;">;;;</button>
                            </div>
                        </div>

                        <div class="form-group">
                            <label>File structure:</label>
                            <div class="checkbox-group">
                                <label>
                                    <input type="checkbox" id="hasTOTP" checked>
                                    File has TOTP field (3rd column)
                                </label>
                            </div>
                            <small>If unchecked, 3rd column will be treated as extra info</small>
                        </div>

                        <div class="form-group">
                            <label>Preview (first 3 lines):</label>
                            <div class="preview-box" id="previewBox">------</div>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn modal-btn-confirm">Import</button>
                    <button class="modal-btn modal-btn-cancel">Cancel</button>
                </div>
            </div>
        `;

        this.element = modal;
        this.attachEvents();
        this.loadPreview();
        return modal;
    }

    attachEvents() {
        super.attachEvents();

        const delimInput = this.element.querySelector('#delimiter');
        const delimBtns = this.element.querySelectorAll('.delim-btn');
        const totpCheckbox = this.element.querySelector('#hasTOTP');

        // Delimiter buttons
        delimBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                this.delimiter = btn.dataset.delim;
                delimInput.value = this.delimiter;
                this.loadPreview();
            });
        });

        // Delimiter input change
        delimInput.addEventListener('input', () => {
            this.delimiter = delimInput.value;
            this.loadPreview();
        });

        // TOTP checkbox change
        totpCheckbox.addEventListener('change', () => {
            this.hasTOTP = totpCheckbox.checked;
            this.loadPreview();
        });
    }

    async loadPreview() {
        if (!this.file) return;

        const previewBox = this.element.querySelector('#previewBox');
        const text = await this.file.text();
        const lines = text.split('\n').filter(l => l.trim() && !l.startsWith('#')).slice(0, 3);
        
        // Field colors depending on hasTOTP
        const fieldColors = this.hasTOTP ? [
            '#00ff88', // Email (first field) - green
            '#ff0062', // Password (second field) - pink
            '#6f00ff', // TOTP (third field) - purple
            '#888'     // Extras (remaining fields) - gray
        ] : [
            '#00ff88', // Email (first field) - green
            '#ff0062', // Password (second field) - pink
            '#888',    // Extras (third field and beyond) - gray
            '#888'     // Extras - gray
        ];
        
        const coloredLines = lines.map(line => {
            const parts = line.split(this.delimiter);
            const coloredParts = parts.map((part, index) => {
                const color = fieldColors[index] || fieldColors[3]; // Extras color for all others
                return `<span style="color: ${color}">${part}</span>`;
            });
            return `<div>${coloredParts.join(`<span style="color: #ffffff">${this.delimiter}</span>`)}</div>`;
        });
        
        previewBox.innerHTML = coloredLines.join('') || 'No valid lines found';
    }

    async confirm() {
        if (!this.file) {
            notificationManager.show('No file selected');
            return;
        }

        const text = await this.file.text();
        
        // Pass fieldMapping to parser
        const fieldMapping = {
            hasEmail: true,
            hasPassword: true,
            hasTOTP: this.hasTOTP
        };
        
        const result = FileParser.parse(text, this.delimiter, fieldMapping);

        if (result.errors.length > 0) {
            const errorMsg = `Found ${result.errors.length} errors. First error: ${result.errors[0].error}`;
            notificationManager.show(errorMsg, 3000);
        }

        if (result.accounts.length === 0) {
            notificationManager.show('No valid accounts found');
            return;
        }

        const stats = dataStore.importAccounts(result.accounts);
        notificationManager.show(`✓ Imported: ${stats.added} new, ${stats.updated} updated, ${stats.skipped} skipped`);
        
        this.close();
        
        // Trigger UI refresh
        if (window.app && window.app.render) {
            window.app.render();
        }
    }
}

// ============================================================================
// IMPORT JSON MODAL (Full Backup Restore)
// ============================================================================

class ImportJSONModal extends Modal {
    constructor(file) {
        super({
            title: 'Import JSON Backup',
            confirmText: 'Import',
            cancelText: 'Cancel'
        });
        this.file = file;
        this.jsonData = null;
    }

    async create() {
        // Parse JSON file
        try {
            const text = await this.file.text();
            this.jsonData = JSON.parse(text);
        } catch (error) {
            notificationManager.show('Invalid JSON file', 3000);
            return null;
        }

        // Structure validation
        if (!this.jsonData.accounts || !Array.isArray(this.jsonData.accounts)) {
            notificationManager.show('Invalid backup format: missing accounts', 3000);
            return null;
        }

        const accountsCount = this.jsonData.accounts.length;
        const tagsCount = this.jsonData.tags ? this.jsonData.tags.length : 0;
        const exportDate = this.jsonData.exportDate ? new Date(this.jsonData.exportDate).toLocaleString() : 'Unknown';

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-container">
                <div class="modal-header">
                    <h3 class="modal-title">Import JSON Backup</h3>
                    <button class="modal-close" aria-label="Close">✕</button>
                </div>
                <div class="modal-body">
                    <div class="form-group">
                        <label>File: <strong>${this.file.name}</strong></label>
                    </div>
                    
                    <div class="form-group">
                        <label>Backup Information:</label>
                        <div class="preview-box">
                            <div>📅 Export Date: ${exportDate}</div>
                            <div>👤 Accounts: ${accountsCount}</div>
                            <div>🏷️ Tags: ${tagsCount}</div>
                            ${this.jsonData.version ? `<div>📦 Version: ${this.jsonData.version}</div>` : ''}
                        </div>
                    </div>

                    <div class="form-group">
                        <label style="color: #00ff88; font-weight: 600;">Restore Mode:</label>
                        <small>All data from backup will be restored. Existing items with same IDs will be updated.</small>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn modal-btn-confirm">Import</button>
                    <button class="modal-btn modal-btn-cancel">Cancel</button>
                </div>
            </div>
        `;

        this.element = modal;
        this.attachEvents();
        return modal;
    }

    confirm() {
        if (!this.jsonData) {
            notificationManager.show('No data to import');
            return;
        }

        try {
            // Import tags with smart merge (by name, don't overwrite color)
            const tagIdMapping = new Map(); // oldTagId -> newTagId
            const existingTags = dataStore.getTags();
            
            if (this.jsonData.tags && Array.isArray(this.jsonData.tags)) {
                this.jsonData.tags.forEach(importedTag => {
                    // Find existing tag by name (case-insensitive)
                    const existingTag = existingTags.find(t =>
                        t.name.toLowerCase() === importedTag.name.toLowerCase()
                    );
                    
                    if (existingTag) {
                        // Tag with this name already exists - use its ID
                        // DON'T overwrite color - keep existing one
                        tagIdMapping.set(importedTag.id, existingTag.id);
                    } else {
                        // Create new tag (with new ID, not original)
                        const newTag = dataStore.createTag(importedTag.name, importedTag.color);
                        tagIdMapping.set(importedTag.id, newTag.id);
                    }
                });
            }

            // Prepare accounts for import with tag ID remapping
            const accountsToImport = this.jsonData.accounts.map(acc => {
                // Remap tag IDs to current ones (from mapping)
                const mappedTags = acc.tags ?
                    acc.tags.map(oldTagId => tagIdMapping.get(oldTagId)).filter(id => id) :
                    [];
                
                return {
                    email: acc.email,
                    password: acc.password,
                    totp: acc.totp || '',
                    extras: acc.extras || [],
                    tags: mappedTags
                };
            });

            // Use EXISTING import logic (same as for TXT)
            // This ensures:
            // - Duplicate check by email+password
            // - TOTP loss protection
            // - Extras merge
            const stats = dataStore.importAccounts(accountsToImport);
            
            const tagsCount = this.jsonData.tags ? this.jsonData.tags.length : 0;
            notificationManager.show(
                `✓ Imported: ${stats.added} new, ${stats.updated} updated, ${stats.skipped} skipped | Tags: ${tagsCount}`,
                3000
            );
            
            this.close();
            
            // Trigger UI refresh
            if (window.app && window.app.render) {
                window.app.render();
            }
        } catch (error) {
            console.error('Import error:', error);
            notificationManager.show('Import failed: ' + error.message, 3000);
        }
    }
}

// ============================================================================
// EXPORT MODAL
// ============================================================================

class ExportModal extends Modal {
    constructor() {
        super({
            title: 'Export Accounts',
            confirmText: 'Export',
            cancelText: 'Cancel'
        });
    }

    create() {
        const accounts = dataStore.getAccounts();
        const tags = dataStore.getTags();

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-container">
                <div class="modal-header">
                    <h3 class="modal-title">Export Accounts</h3>
                    <button class="modal-close" aria-label="Close">✕</button>
                </div>
                <div class="modal-body">
                    <form id="exportForm">
                        <div class="form-group">
                            <label>What to export:</label>
                            <select name="scope" id="exportScope">
                                <option value="all">All accounts (${accounts.length})</option>
                                <option value="favorite">Favorites only (${accounts.filter(a => a.favorite).length})</option>
                                <option value="active">Active only (${accounts.filter(a => !a.completed).length})</option>
                            </select>
                        </div>

                        <div class="form-group">
                            <label>Format:</label>
                            <select name="format" id="exportFormat">
                                <option value="txt">TXT (credentials only)</option>
                                <option value="json">JSON (full backup with metadata)</option>
                            </select>
                        </div>

                        <div id="txtOptions">
                            <div class="form-group">
                                <label for="exportDelimiter">Delimiter:</label>
                                <input type="text" id="exportDelimiter" name="delimiter" value="|" maxlength="3">
                            </div>

                            <div class="form-group">
                                <label>Fields to export:</label>
                                <div class="checkbox-group">
                                    <label><input type="checkbox" name="field_email" checked> Email</label>
                                    <label><input type="checkbox" name="field_password" checked> Password</label>
                                    <label><input type="checkbox" name="field_totp" checked> TOTP</label>
                                    <label><input type="checkbox" name="field_extras" checked> Extra info</label>
                                </div>
                            </div>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn modal-btn-confirm">Export</button>
                    <button class="modal-btn modal-btn-cancel">Cancel</button>
                </div>
            </div>
        `;

        this.element = modal;
        this.attachEvents();
        this.attachExportEvents();
        return modal;
    }

    attachExportEvents() {
        const formatSelect = this.element.querySelector('#exportFormat');
        const txtOptions = this.element.querySelector('#txtOptions');

        formatSelect.addEventListener('change', () => {
            txtOptions.style.display = formatSelect.value === 'txt' ? 'block' : 'none';
        });
    }

    confirm() {
        const form = this.element.querySelector('#exportForm');
        const formData = new FormData(form);
        
        const scope = formData.get('scope');
        const format = formData.get('format');
        
        let accounts = dataStore.getAccounts();
        
        // Filter by scope
        if (scope === 'favorite') {
            accounts = accounts.filter(a => a.favorite);
        } else if (scope === 'active') {
            accounts = accounts.filter(a => !a.completed);
        }

        if (accounts.length === 0) {
            notificationManager.show('No accounts to export');
            return;
        }

        const accountIds = accounts.map(a => a.id);
        let content, filename;

        if (format === 'json') {
            content = dataStore.exportAccounts({ accountIds, format: 'json' });
            filename = `credentials_backup_${new Date().toISOString().split('T')[0]}.json`;
        } else {
            const delimiter = formData.get('delimiter') || '|';
            const fields = {
                email: formData.get('field_email') === 'on',
                password: formData.get('field_password') === 'on',
                totp: formData.get('field_totp') === 'on',
                extras: formData.get('field_extras') === 'on'
            };
            
            content = dataStore.exportAccounts({ accountIds, format: 'txt', delimiter, fields });
            filename = `credentials_export_${new Date().toISOString().split('T')[0]}.txt`;
        }

        // Download file
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);

        notificationManager.show(`✓ Exported ${accounts.length} accounts`);
        this.close();
    }
}

// ============================================================================
// ADD/EDIT ACCOUNT MODAL
// ============================================================================

class AccountModal extends Modal {
    constructor(accountId = null) {
        super({
            title: accountId ? 'Edit Account' : 'New Account',
            confirmText: accountId ? 'Save' : 'Add',
            cancelText: 'Cancel'
        });
        this.accountId = accountId;
        this.account = accountId ? dataStore.getAccount(accountId) : null;
    }

    create() {
        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-container">
                <div class="modal-header">
                    <h3 class="modal-title">${this.title}</h3>
                    <button class="modal-close" aria-label="Close">✕</button>
                </div>
                <div class="modal-body">
                    <form id="accountForm">
                        <div class="form-group">
                            <label for="email">Email: *</label>
                            <input type="email" id="email" name="email" value="${this.account ? this.account.email : ''}" required>
                        </div>

                        <div class="form-group">
                            <label for="password">Password: *</label>
                            <div class="password-input-group">
                                <input type="password" id="password" name="password" value="${this.account ? this.account.password : ''}" required>
                                <button type="button" class="toggle-password" aria-label="Show password">👁️</button>
                            </div>
                        </div>

                        <div class="form-group">
                            <label for="totp">TOTP Secret (optional):</label>
                            <input type="text" id="totp" name="totp" value="${this.account ? this.account.totp : ''}" maxlength="32" placeholder="32 alphanumeric characters">
                            <small>Leave empty if account has no 2FA. If provided, must be exactly 32 alphanumeric characters</small>
                        </div>

                        <div class="form-group">
                            <label for="extras">Username/Info (optional):</label>
                            <input type="text" id="extras" name="extras" value="${this.account ? this.account.extras.join(', ') : ''}" placeholder="work account, personal">
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn modal-btn-confirm">${this.confirmText}</button>
                    <button class="modal-btn modal-btn-cancel">Cancel</button>
                </div>
            </div>
        `;

        this.element = modal;
        this.attachEvents();
        this.attachAccountEvents();
        return modal;
    }

    attachAccountEvents() {
        const togglePassword = this.element.querySelector('.toggle-password');
        const passwordInput = this.element.querySelector('#password');

        togglePassword.addEventListener('click', () => {
            const type = passwordInput.type === 'password' ? 'text' : 'password';
            passwordInput.type = type;
        });
    }

    confirm() {
        const form = this.element.querySelector('#accountForm');
        const formData = new FormData(form);

        const email = formData.get('email').trim();
        const password = formData.get('password').trim();
        const totp = formData.get('totp').trim();
        const extrasStr = formData.get('extras').trim();

        if (!Utils.validateEmail(email)) {
            notificationManager.show('Invalid email format');
            return;
        }

        // TOTP validation: if not empty, must be 32 characters
        if (totp && !Utils.validateTOTP(totp)) {
            notificationManager.show('TOTP must be exactly 32 alphanumeric characters (or leave empty)');
            return;
        }

        const extras = extrasStr ? extrasStr.split(',').map(e => e.trim()).filter(e => e) : [];

        const accountData = { email, password, totp: totp || '', extras };

        if (this.accountId) {
            dataStore.updateAccount(this.accountId, accountData);
            notificationManager.show('Account updated');
        } else {
            dataStore.addAccount(accountData);
            notificationManager.show('Account added');
        }

        this.close();
        if (window.app && window.app.render) window.app.render();
    }
}

// ============================================================================
// DELETE CONFIRMATION MODAL
// ============================================================================

class DeleteAccountModal extends Modal {
    constructor(accountId) {
        const account = dataStore.getAccount(accountId);
        super({
            title: 'Delete Account?',
            content: `
                <p>Are you sure you want to delete this account?</p>
                <p><strong>${account ? account.email : 'Unknown'}</strong></p>
                <p style="color: #ff6b6b;">This action cannot be undone.</p>
            `,
            confirmText: 'Delete',
            cancelText: 'Cancel'
        });
        this.accountId = accountId;
    }

    confirm() {
        dataStore.deleteAccount(this.accountId);
        notificationManager.show('Account deleted');
        this.close();
        if (window.app && window.app.render) window.app.render();
    }
}

// ============================================================================
// TAG MANAGEMENT MODAL
// ============================================================================

class TagModal extends Modal {
    constructor(tagId = null) {
        super({
            title: tagId ? 'Edit Tag' : 'New Tag',
            confirmText: tagId ? 'Save' : 'Create',
            cancelText: 'Cancel'
        });
        this.tagId = tagId;
        this.tag = tagId ? dataStore.getTag(tagId) : null;
    }

    create() {
        const colors = ['#6f00ff', '#ff0062', '#00ff88', '#00d4ff', '#ffd700', '#ff6b6b'];

        const modal = document.createElement('div');
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-container">
                <div class="modal-header">
                    <h3 class="modal-title">${this.title}</h3>
                    <button class="modal-close" aria-label="Close">✕</button>
                </div>
                <div class="modal-body">
                    <form id="tagForm">
                        <div class="form-group">
                            <label for="tagName">Tag Name: *</label>
                            <input type="text" id="tagName" name="name" value="${this.tag ? this.tag.name : ''}" required>
                        </div>

                        <div class="form-group">
                            <label>Color:</label>
                            <div class="color-picker">
                                ${colors.map(color => `
                                    <label class="color-option">
                                        <input type="radio" name="color" value="${color}" ${this.tag && this.tag.color === color ? 'checked' : ''}>
                                        <span class="color-circle" style="background-color: ${color}"></span>
                                    </label>
                                `).join('')}
                            </div>
                        </div>
                    </form>
                </div>
                <div class="modal-footer">
                    <button class="modal-btn modal-btn-confirm">${this.confirmText}</button>
                    <button class="modal-btn modal-btn-cancel">Cancel</button>
                </div>
            </div>
        `;

        this.element = modal;
        this.attachEvents();
        return modal;
    }

    confirm() {
        const form = this.element.querySelector('#tagForm');
        const formData = new FormData(form);

        const name = formData.get('name').trim();
        const color = formData.get('color') || '#6f00ff';

        if (!name) {
            notificationManager.show('Tag name is required');
            return;
        }

        if (this.tagId) {
            dataStore.updateTag(this.tagId, { name, color });
            notificationManager.show('Tag updated');
        } else {
            dataStore.createTag(name, color);
            notificationManager.show('Tag created');
        }

        this.close();
        if (window.app && window.app.render) window.app.render();
    }
}

// ============================================================================
// CLEAR DATA CONFIRMATION MODAL
// ============================================================================

class ClearDataModal extends Modal {
    constructor() {
        super({
            title: 'Clear All Data?',
            content: `
                <p>Are you sure you want to clear all data?</p>
                <p style="color: #ff6b6b; font-weight: 600; margin-top: 12px;">This action cannot be undone.</p>
                <p style="color: #888; font-size: 13px; margin-top: 12px;">All accounts, tags, and settings will be permanently deleted.</p>
            `,
            confirmText: 'Clear All Data',
            cancelText: 'Cancel'
        });
    }

    confirm() {
        dataStore.clearAllData();
        notificationManager.show('All data cleared');
        this.close();
        if (window.app) window.app.render();
    }
}

// ============================================================================
// QUICK TAG SELECTOR (Dropdown without modal)
// ============================================================================

class QuickTagSelector {
    constructor(accountId, buttonElement) {
        this.accountId = accountId;
        this.buttonElement = buttonElement;
        this.dropdown = null;
    }

    /**
     * Shows dropdown with tags
     */
    show() {
        if (this.dropdown) {
            this.hide();
            return;
        }

        const tags = dataStore.getTags();
        const account = dataStore.getAccount(this.accountId);
        if (!account) return;

        // Create dropdown
        this.dropdown = document.createElement('div');
        this.dropdown.className = 'quick-tag-dropdown';
        
        const tagsHTML = tags.map(tag => {
            const hasTag = account.tags.includes(tag.id);
            return `
                <div class="quick-tag-item ${hasTag ? 'active' : ''}" data-tag-id="${tag.id}">
                    <span class="tag-pill" style="background-color: ${tag.color}20; border-color: ${tag.color}">${tag.name}</span>
                    <span class="quick-tag-check">${hasTag ? '✓' : '+'}</span>
                </div>
            `;
        }).join('');

        this.dropdown.innerHTML = `
            ${tagsHTML}
            <div class="quick-tag-divider"></div>
            <div class="quick-tag-item quick-tag-new" data-action="new-tag">
                <span>+ New Tag</span>
            </div>
        `;

        // Position dropdown
        const rect = this.buttonElement.getBoundingClientRect();
        this.dropdown.style.position = 'fixed';
        this.dropdown.style.top = `${rect.bottom + 5}px`;
        this.dropdown.style.right = `${window.innerWidth - rect.right}px`;

        document.body.appendChild(this.dropdown);

        // Show animation
        setTimeout(() => this.dropdown.classList.add('show'), 10);

        // Event handlers
        this.dropdown.querySelectorAll('.quick-tag-item[data-tag-id]').forEach(item => {
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                const tagId = item.dataset.tagId;
                this.toggleTag(tagId);
            });
        });

        this.dropdown.querySelector('[data-action="new-tag"]')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.hide();
            const modal = new TagModal();
            modal.show();
        });

        // Close on click outside dropdown
        setTimeout(() => {
            document.addEventListener('click', this.handleOutsideClick);
        }, 100);
    }

    /**
     * Toggles tag for account
     */
    toggleTag(tagId) {
        const account = dataStore.getAccount(this.accountId);
        if (!account) return;

        if (account.tags.includes(tagId)) {
            dataStore.removeTagFromAccount(this.accountId, tagId);
            notificationManager.show('Tag removed');
        } else {
            dataStore.addTagToAccount(this.accountId, tagId);
            notificationManager.show('Tag added');
        }

        // Update dropdown
        this.hide();
        this.show();
    }

    /**
     * Hides dropdown
     */
    hide() {
        if (!this.dropdown) return;

        this.dropdown.classList.remove('show');
        setTimeout(() => {
            if (this.dropdown && document.body.contains(this.dropdown)) {
                document.body.removeChild(this.dropdown);
            }
            this.dropdown = null;
        }, 200);

        document.removeEventListener('click', this.handleOutsideClick);
    }

    /**
     * Click outside dropdown handler
     */
    handleOutsideClick = (e) => {
        if (this.dropdown && !this.dropdown.contains(e.target) && e.target !== this.buttonElement) {
            this.hide();
        }
    }
}

// ============================================================================
// DRAG & DROP MANAGER
// ============================================================================

class DragDropManager {
    constructor() {
        this.draggedAccountId = null;
        this.draggedElement = null;
        this.dropZones = [];
        this.cachedDropZoneElements = []; // Element cache for performance
    }

    /**
     * Updates drop zone element cache (called on sidebar render)
     */
    updateDropZoneCache() {
        this.cachedDropZoneElements = Array.from(
            document.querySelectorAll('.tag-filter-item, .filter-item[data-filter="favorite"], .filter-item[data-filter="completed"], .filter-item[data-filter="active"]')
        );
    }

    /**
     * Initializes drag for account card (ORIGINAL WORKING VERSION)
     */
    initAccountDrag(accountId, cardElement) {
        const dragHandle = cardElement.querySelector('.drag-handle');
        if (!dragHandle) return;

        // Make card draggable
        cardElement.setAttribute('draggable', 'true');

        // Flag to track drag start from handle
        let canDrag = false;

        // Allow drag only when clicking on handle
        dragHandle.addEventListener('mousedown', (e) => {
            canDrag = true;
        });

        // Prevent drag when clicking on other elements
        cardElement.addEventListener('mousedown', (e) => {
            if (!dragHandle.contains(e.target)) {
                canDrag = false;
            }
        });

        cardElement.addEventListener('dragstart', (e) => {
            if (!canDrag) {
                e.preventDefault();
                return;
            }

            this.draggedAccountId = accountId;
            this.draggedElement = cardElement;
            cardElement.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'copyMove';
            e.dataTransfer.setData('text/plain', accountId);
            
            // Create custom drag image - copy of email card
            const account = dataStore.getAccount(accountId);
            if (account) {
                const dragImage = document.createElement('div');
                dragImage.className = 'drag-image-temp'; // Class for tracking
                dragImage.style.cssText = `
                    position: absolute;
                    top: -9999px;
                    left: -9999px;
                    background: #2a2a2a;
                    border: 2px solid #333;
                    border-left: 3px solid #6f00ff;
                    border-radius: 12px;
                    padding: 16px;
                    min-width: 250px;
                    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
                `;
                
                dragImage.innerHTML = `
                    <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; font-weight: 600; color: #888; margin-bottom: 8px; font-family: 'Outfit', 'Inter', sans-serif;">EMAIL</div>
                    <div style="font-size: 16px; font-weight: 500; color: #ffffff; font-family: 'SF Mono', 'Monaco', 'Inconsolata', monospace;">${account.email}</div>
                `;
                
                document.body.appendChild(dragImage);
                
                // Set custom image (cursor at top left corner)
                e.dataTransfer.setDragImage(dragImage, 5, 5);
                
                // Guaranteed removal of temporary element
                const cleanup = () => {
                    if (document.body.contains(dragImage)) {
                        document.body.removeChild(dragImage);
                    }
                };
                
                // Remove immediately after drag starts
                setTimeout(cleanup, 0);
                
                // Additional protection - remove after 100ms if something went wrong
                setTimeout(cleanup, 100);
            }
            
            // Add dashed border to all tags and filters (using cache)
            this.cachedDropZoneElements.forEach(el => {
                el.classList.add('account-drag-active');
            });
        });

        cardElement.addEventListener('dragend', (e) => {
            cardElement.classList.remove('dragging');
            canDrag = false;
            
            // Remove all drop-over classes and dashed borders (using cache)
            this.cachedDropZoneElements.forEach(el => {
                el.classList.remove('drop-over', 'drop-over-top', 'drop-over-bottom', 'account-drag-active');
            });
            
            // Clear draggedAccountId with delay so drop event can fire
            setTimeout(() => {
                this.draggedAccountId = null;
                this.draggedElement = null;
            }, 50);
        });

        // Drop between cards to change order
        cardElement.addEventListener('dragover', (e) => {
            if (this.draggedAccountId && this.draggedAccountId !== accountId) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                
                const rect = cardElement.getBoundingClientRect();
                const midpoint = rect.top + rect.height / 2;
                
                if (e.clientY < midpoint) {
                    cardElement.classList.add('drop-over-top');
                    cardElement.classList.remove('drop-over-bottom');
                } else {
                    cardElement.classList.add('drop-over-bottom');
                    cardElement.classList.remove('drop-over-top');
                }
            }
        });

        cardElement.addEventListener('dragleave', (e) => {
            // Check that we actually left the element
            const rect = cardElement.getBoundingClientRect();
            if (e.clientX < rect.left || e.clientX >= rect.right ||
                e.clientY < rect.top || e.clientY >= rect.bottom) {
                cardElement.classList.remove('drop-over-top', 'drop-over-bottom');
            }
        });

        cardElement.addEventListener('drop', (e) => {
            e.preventDefault();
            cardElement.classList.remove('drop-over-top', 'drop-over-bottom');
            
            if (this.draggedAccountId && this.draggedAccountId !== accountId) {
                const draggedAccount = dataStore.getAccount(this.draggedAccountId);
                const targetAccount = dataStore.getAccount(accountId);
                
                if (draggedAccount && targetAccount) {
                    // Determine new position
                    const rect = cardElement.getBoundingClientRect();
                    const midpoint = rect.top + rect.height / 2;
                    let newOrder = targetAccount.order;
                    
                    // If dropping below midpoint - insert after
                    if (e.clientY >= midpoint) {
                        newOrder = targetAccount.order + 1;
                    }
                    
                    dataStore.reorderAccounts(this.draggedAccountId, newOrder);
                    if (window.app) window.app.scheduleRender();
                }
            }
        });
    }

    /**
     * Initializes drop zone for tag
     */
    initTagDropZone(tagId, tagElement) {
        tagElement.addEventListener('dragover', (e) => {
            // Check that this is a card (has draggedAccountId), not a file
            if (this.draggedAccountId) {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
                tagElement.classList.add('drop-over');
            }
        });

        tagElement.addEventListener('dragleave', (e) => {
            tagElement.classList.remove('drop-over');
        });

        tagElement.addEventListener('drop', (e) => {
            // Check that this is a card (has draggedAccountId)
            if (this.draggedAccountId) {
                e.preventDefault();
                e.stopPropagation();
                tagElement.classList.remove('drop-over');
                
                if (this.draggedAccountId) {
                    const account = dataStore.getAccount(this.draggedAccountId);
                    if (account && !account.tags.includes(tagId)) {
                        dataStore.addTagToAccount(this.draggedAccountId, tagId);
                        const tag = dataStore.getTag(tagId);
                        notificationManager.show(`Added to "${tag.name}"`);
                        if (window.app) window.app.scheduleRender();
                    } else if (account && account.tags.includes(tagId)) {
                        notificationManager.show('Tag already added');
                    }
                }
            }
        });
    }

    /**
     * Initializes drop zone for filters (All, Favorites, Untagged, etc)
     */
    initFilterDropZone(filterElement, filterType) {
        filterElement.addEventListener('dragover', (e) => {
            // Check that this is a card (has draggedAccountId)
            if (this.draggedAccountId) {
                e.preventDefault();
                e.stopPropagation();
                e.dataTransfer.dropEffect = 'copy';
                filterElement.classList.add('drop-over');
            }
        });

        filterElement.addEventListener('dragleave', (e) => {
            filterElement.classList.remove('drop-over');
        });

        filterElement.addEventListener('drop', (e) => {
            // Check that this is a card (has draggedAccountId)
            if (this.draggedAccountId) {
                e.preventDefault();
                e.stopPropagation();
                filterElement.classList.remove('drop-over');
                
                if (this.draggedAccountId) {
                    const account = dataStore.getAccount(this.draggedAccountId);
                    if (!account) return;

                    if (filterType === 'untagged') {
                        // Remove all tags from account
                        if (account.tags && account.tags.length > 0) {
                            const tagsCount = account.tags.length;
                            account.tags = [];
                            dataStore.autoSave();
                            notificationManager.show(`Removed ${tagsCount} tag${tagsCount > 1 ? 's' : ''}`);
                            if (window.app) window.app.scheduleRender();
                        } else {
                            notificationManager.show('Account has no tags');
                        }
                    } else if (filterType === 'favorite' && !account.favorite) {
                        dataStore.toggleAccountFavorite(this.draggedAccountId);
                        notificationManager.show('Added to Favorites');
                        if (window.app) window.app.scheduleRender();
                    } else if (filterType === 'completed' && !account.completed) {
                        dataStore.toggleAccountCompleted(this.draggedAccountId);
                        notificationManager.show('Marked as Completed');
                        if (window.app) window.app.scheduleRender();
                    } else if (filterType === 'active' && account.completed) {
                        dataStore.toggleAccountCompleted(this.draggedAccountId);
                        notificationManager.show('Marked as Active');
                        if (window.app) window.app.scheduleRender();
                    }
                }
            }
        });
    }
}

// ============================================================================
// SEARCH & FILTER MANAGER
// ============================================================================

class SearchManager {
    constructor() {
        this.query = '';
        this.selectedTags = [];
        this.statusFilter = 'all';
        this.showUntagged = false; // Filter for accounts without tags
    }

    getFilteredAccounts() {
        let accounts = dataStore.getAccountsSorted(); // Use sorted accounts

        if (this.query) {
            const lowerQuery = this.query.toLowerCase();
            accounts = accounts.filter(acc => {
                return acc.email.toLowerCase().includes(lowerQuery) ||
                       acc.extras.some(extra => extra.toLowerCase().includes(lowerQuery)) ||
                       acc.tags.some(tagId => {
                           const tag = dataStore.getTag(tagId);
                           return tag && tag.name.toLowerCase().includes(lowerQuery);
                       });
            });
        }

        if (this.showUntagged) {
            // Show only accounts without tags
            accounts = accounts.filter(acc => !acc.tags || acc.tags.length === 0);
        } else if (this.selectedTags.length > 0) {
            // Show accounts with selected tags
            accounts = accounts.filter(acc =>
                this.selectedTags.every(tagId => acc.tags.includes(tagId))
            );
        }

        if (this.statusFilter !== 'all') {
            accounts = accounts.filter(acc => {
                switch (this.statusFilter) {
                    case 'completed':
                        return acc.completed;
                    case 'active':
                        return !acc.completed;
                    case 'favorite':
                        return acc.favorite;
                    default:
                        return true;
                }
            });
        }

        return accounts;
    }

    setQuery(query) {
        this.query = query;
    }

    toggleTag(tagId) {
        const index = this.selectedTags.indexOf(tagId);
        if (index > -1) {
            this.selectedTags.splice(index, 1);
        } else {
            this.selectedTags.push(tagId);
        }
        // If selecting a tag, disable "untagged" filter
        if (this.selectedTags.length > 0) {
            this.showUntagged = false;
        }
    }

    toggleUntagged() {
        this.showUntagged = !this.showUntagged;
        // If enabling "untagged" filter, reset selected tags
        if (this.showUntagged) {
            this.selectedTags = [];
        }
    }

    setStatusFilter(status) {
        this.statusFilter = status;
    }

    clearFilters() {
        this.query = '';
        this.selectedTags = [];
        this.statusFilter = 'all';
        this.showUntagged = false;
    }
}

// ============================================================================
// APPLICATION CLASS
// ============================================================================

class CredentialsApp {
    constructor() {
        this.totpUpdateInterval = null;
        this.dragDropManager = new DragDropManager();
        this.visibleCards = new Set(); // Track visible cards
        this.intersectionObserver = null;
        this.renderedAccounts = new Map(); // Cache of rendered cards: accountId -> HTMLElement
        this.lastSidebarState = null; // Cache of sidebar state for memoization
        this.renderScheduled = false; // Flag for debounced render
        this.eventListeners = []; // Array to track all listeners (for cleanup)
        this.stateSubscriptions = []; // Array of StateManager subscriptions (for cleanup)
        this.init();
    }

    /**
     * Initialize application
     */
    init() {
        this.setupEventListeners();
        this.setupDragAndDrop();
        this.setupIntersectionObserver();
        this.setupSidebarEventDelegation(); // CRITICAL: Set up sidebar listeners ONCE
        this.render();
        this.startTOTPUpdates();
        
        // Subscribe to data changes with incremental updates (save references for cleanup)
        this.stateSubscriptions.push(
            { event: 'accountAdded', callback: (account) => this.scheduleRender() },
            { event: 'accountUpdated', callback: (account) => this.updateSingleAccount(account.id) },
            { event: 'accountDeleted', callback: () => this.scheduleRender() },
            { event: 'tagCreated', callback: () => this.scheduleRender() },
            { event: 'tagDeleted', callback: () => this.scheduleRender() },
            { event: 'accountsReordered', callback: () => this.scheduleRender() }
        );
        
        this.stateSubscriptions.forEach(sub => {
            dataStore.state.subscribe(sub.event, sub.callback);
        });
    }

    /**
     * Destroy application and cleanup all resources (prevent memory leaks)
     */
    destroy() {
        // Stop TOTP updates
        if (this.totpUpdateInterval) {
            clearTimeout(this.totpUpdateInterval);
            this.totpUpdateInterval = null;
        }

        // Disconnect IntersectionObserver
        if (this.intersectionObserver) {
            this.intersectionObserver.disconnect();
            this.intersectionObserver = null;
        }

        // Unsubscribe from all StateManager events
        this.stateSubscriptions.forEach(sub => {
            dataStore.state.unsubscribe(sub.event, sub.callback);
        });
        this.stateSubscriptions = [];

        // Clear all DOM references
        this.renderedAccounts.clear();
        this.visibleCards.clear();

        // Clear TOTP cache
        TOTP.clearAll();

        // Remove all temporary drag image elements (if any remain)
        document.querySelectorAll('.drag-image-temp').forEach(el => {
            if (document.body.contains(el)) {
                document.body.removeChild(el);
            }
        });

        // Clear container
        const container = document.getElementById('credentialsList');
        if (container) {
            container.innerHTML = '';
        }

        console.log('CredentialsApp destroyed - all resources cleaned up');
    }

    /**
     * Schedule render with debouncing to batch multiple updates
     */
    scheduleRender() {
        if (this.renderScheduled) return;
        
        this.renderScheduled = true;
        requestAnimationFrame(() => {
            this.render();
            this.renderScheduled = false;
        });
    }

    /**
     * Update single account card without full re-render (incremental update)
     */
    updateSingleAccount(accountId) {
        const account = dataStore.getAccount(accountId);
        if (!account) return;

        const existingCard = this.renderedAccounts.get(accountId);
        if (!existingCard || !document.body.contains(existingCard)) {
            // Card not in DOM or doesn't exist - need full render
            this.scheduleRender();
            return;
        }

        // Update only card content, without touching structure
        const newCardHTML = this.renderAccountCard(account);
        const tempDiv = document.createElement('div');
        tempDiv.innerHTML = newCardHTML;
        const newCard = tempDiv.firstElementChild;

        // Copy data attributes and classes
        existingCard.className = newCard.className;
        existingCard.dataset.accountId = newCard.dataset.accountId;

        // Update only changeable parts (don't touch drag handle and actions)
        const existingHeader = existingCard.querySelector('.credential-header');
        const newHeader = newCard.querySelector('.credential-header');
        if (existingHeader && newHeader) {
            existingHeader.innerHTML = newHeader.innerHTML;
        }

        const existingMain = existingCard.querySelector('.credential-main');
        const newMain = newCard.querySelector('.credential-main');
        if (existingMain && newMain) {
            // Update email and password, but NOT TOTP (it updates separately)
            const existingEmail = existingMain.querySelector('.email-item .item-value');
            const newEmail = newMain.querySelector('.email-item .item-value');
            if (existingEmail && newEmail) {
                existingEmail.textContent = newEmail.textContent;
            }
        }

        // Update action buttons
        const existingActions = existingCard.querySelector('.credential-actions-right');
        const newActions = newCard.querySelector('.credential-actions-right');
        if (existingActions && newActions) {
            existingActions.innerHTML = newActions.innerHTML;
        }

        // Update sidebar (counters may have changed)
        this.updateSidebarCounts();
    }

    /**
     * Setup Intersection Observer to track visible cards
     */
    setupIntersectionObserver() {
        // Create observer with small margin for preloading
        this.intersectionObserver = new IntersectionObserver((entries) => {
            let needsTOTPUpdate = false;
            
            entries.forEach(entry => {
                const accountId = entry.target.dataset.accountId;
                if (entry.isIntersecting) {
                    const wasVisible = this.visibleCards.has(accountId);
                    this.visibleCards.add(accountId);
                    
                    // Initialize drag only for visible cards
                    if (!wasVisible) {
                        this.dragDropManager.initAccountDrag(accountId, entry.target);
                        needsTOTPUpdate = true;
                    }
                } else {
                    this.visibleCards.delete(accountId);
                }
            });

            // Update TOTP for all new visible cards in one batch
            if (needsTOTPUpdate) {
                this.updateVisibleTOTPs();
            }
        }, {
            root: null, // viewport
            rootMargin: '200px', // Preload 200px before appearing
            threshold: 0.01 // Consider visible if at least 1% is visible
        });
    }

    /**
     * Setup drag and drop for file import
     */
    setupDragAndDrop() {
        const importBtn = document.getElementById('btnImport');
        if (!importBtn) return;

        let dragCounter = 0; // Counter to track nested dragenter/dragleave

        // Highlight button when file enters the page (dashed white)
        document.body.addEventListener('dragenter', (e) => {
            // Check that this is a file, not a card
            if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                dragCounter++;
                importBtn.classList.add('file-drag-active');
            }
        });

        document.body.addEventListener('dragleave', (e) => {
            // Check that this is a file
            if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                dragCounter--;
                if (dragCounter === 0) {
                    importBtn.classList.remove('file-drag-active', 'file-drag-hover');
                }
            }
        });

        document.body.addEventListener('dragover', (e) => {
            // Check that this is a file
            if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                e.preventDefault(); // Required for drop to work
            }
        });

        document.body.addEventListener('drop', (e) => {
            // Check that this is a file
            if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                dragCounter = 0;
                importBtn.classList.remove('file-drag-active', 'file-drag-hover');
            }
        });

        // Handlers on the button itself (solid green on hover)
        importBtn.addEventListener('dragenter', (e) => {
            if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                importBtn.classList.remove('file-drag-active');
                importBtn.classList.add('file-drag-hover');
            }
        });

        importBtn.addEventListener('dragleave', (e) => {
            if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                importBtn.classList.remove('file-drag-hover');
                importBtn.classList.add('file-drag-active');
            }
        });

        importBtn.addEventListener('dragover', (e) => {
            // Check that this is a file
            if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                e.stopPropagation();
            }
        });

        // Handle dropped files
        importBtn.addEventListener('drop', (e) => {
            if (e.dataTransfer && e.dataTransfer.types && e.dataTransfer.types.includes('Files')) {
                e.preventDefault();
                e.stopPropagation();
                
                // Reset counter and remove all drag classes
                dragCounter = 0;
                importBtn.classList.remove('file-drag-active', 'file-drag-hover');
                
                const files = e.dataTransfer.files;
                if (files.length > 0) {
                    const file = files[0];
                    if (file.type === 'text/plain' || file.name.endsWith('.txt') ||
                        file.type === 'application/json' || file.name.endsWith('.json')) {
                        this.handleFileImport(file);
                    } else {
                        notificationManager.show('Please select a TXT or JSON file');
                    }
                }
            }
        });
    }

    /**
     * Setup all event listeners
     */
    setupEventListeners() {
        // Block browser context menu on entire page
        // Allow only for input fields (input, textarea)
        document.addEventListener('contextmenu', (e) => {
            const target = e.target;
            // Allow context menu only for input fields
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
                return; // Allow browser menu for copy/paste
            }
            // Block for everything else
            e.preventDefault();
        });

        // Import button
        document.getElementById('btnImport')?.addEventListener('click', () => {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.txt,.json';
            input.onchange = (e) => this.handleFileImport(e.target.files[0]);
            input.click();
        });

        // Export button
        document.getElementById('btnExport')?.addEventListener('click', () => {
            const modal = new ExportModal();
            modal.show();
        });

        // Add account button
        document.getElementById('btnAddAccount')?.addEventListener('click', () => {
            const modal = new AccountModal();
            modal.show();
        });

        // Clear data button
        document.getElementById('clearData')?.addEventListener('click', () => {
            const modal = new ClearDataModal();
            modal.show();
        });

        // Search input
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', Utils.debounce((e) => {
                searchManager.setQuery(e.target.value);
                this.render();
            }, 300));
        }

        // Event Delegation for account cards (one listener instead of thousands)
        this.setupAccountsEventDelegation();

        // Keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            // Ctrl+F or / for search
            if ((e.ctrlKey && e.key === 'f') || e.key === '/') {
                e.preventDefault();
                document.getElementById('searchInput')?.focus();
            }
            // Ctrl+N for new account
            if (e.ctrlKey && e.key === 'n') {
                e.preventDefault();
                const modal = new AccountModal();
                modal.show();
            }
            // Ctrl+E for export
            if (e.ctrlKey && e.key === 'e') {
                e.preventDefault();
                const modal = new ExportModal();
                modal.show();
            }
            // Ctrl+I for import
            if (e.ctrlKey && e.key === 'i') {
                e.preventDefault();
                document.getElementById('btnImport')?.click();
            }
        });
    }

    /**
     * Setup event delegation for account cards (architectural solution)
     * ONE listener instead of thousands - scales to any number of accounts
     */
    setupAccountsEventDelegation() {
        const container = document.getElementById('credentialsList');
        if (!container) return;

        container.addEventListener('click', async (e) => {
            // Find closest card
            const card = e.target.closest('.credential');
            if (!card) return;

            const accountId = card.dataset.accountId;
            const account = dataStore.getAccount(accountId);
            if (!account) return;

            // Determine what was clicked
            const action = e.target.closest('[data-action]');
            if (!action) return;

            e.stopPropagation();
            const actionType = action.dataset.action;

            switch (actionType) {
                case 'copy-email':
                    const emailText = await Clipboard.copy(account.email);
                    notificationManager.show(`Copied: ${emailText}`);
                    dataStore.updateLastUsed(accountId);
                    break;

                case 'copy-password':
                    const passText = await Clipboard.copy(account.password, 'password');
                    notificationManager.show(`Copied: ${passText}`);
                    dataStore.updateLastUsed(accountId);
                    break;

                case 'copy-totp':
                    const totpElement = action.querySelector('.totp-code');
                    const code = totpElement?.textContent;
                    if (code && code !== '------' && code !== 'Error') {
                        await Clipboard.copy(code);
                        notificationManager.show(`Copied: ${code}`);
                        dataStore.updateLastUsed(accountId);
                    }
                    break;

                case 'copy-username':
                    if (account.extras.length > 0) {
                        const usernameText = await Clipboard.copy(account.extras.join(', '));
                        notificationManager.show(`Copied: ${usernameText}`);
                    }
                    break;

                case 'toggle-completed':
                    dataStore.toggleAccountCompleted(accountId);
                    break;

                case 'edit':
                    const editModal = new AccountModal(accountId);
                    editModal.show();
                    break;

                case 'quick-tag':
                    const selector = new QuickTagSelector(accountId, action);
                    selector.show();
                    break;

                case 'favorite':
                    dataStore.toggleAccountFavorite(accountId);
                    break;

                case 'delete':
                    const deleteModal = new DeleteAccountModal(accountId);
                    deleteModal.show();
                    break;
            }
        });
    }

    /**
     * Handle file import (TXT or JSON)
     */
    async handleFileImport(file) {
        if (!file) return;

        // Determine file type
        const isJSON = file.type === 'application/json' || file.name.endsWith('.json');

        if (isJSON) {
            // JSON backup restore
            const modal = new ImportJSONModal(file);
            const created = await modal.create();
            if (created) {
                modal.show();
            }
        } else {
            // TXT file with delimiter
            const text = await file.text();
            const detectedDelimiter = FileParser.detectDelimiter(text);

            const modal = new ImportModal();
            modal.file = file;
            modal.delimiter = detectedDelimiter || '|';
            modal.show();
        }
    }

    /**
     * Render entire application
     */
    render() {
        this.renderSidebar();
        this.renderAccounts();
    }

    /**
     * Update only sidebar counts without full re-render (performance optimization)
     */
    updateSidebarCounts() {
        const accounts = dataStore.getAccounts();
        
        // Update filter counters
        const allCount = document.querySelector('[data-filter="all"] .count');
        if (allCount) allCount.textContent = accounts.length;
        
        const favCount = document.querySelector('[data-filter="favorite"] .count');
        if (favCount) favCount.textContent = accounts.filter(a => a.favorite).length;
        
        const activeCount = document.querySelector('[data-filter="active"] .count');
        if (activeCount) activeCount.textContent = accounts.filter(a => !a.completed).length;
        
        const completedCount = document.querySelector('[data-filter="completed"] .count');
        if (completedCount) completedCount.textContent = accounts.filter(a => a.completed).length;
        
        const untaggedCount = document.querySelector('[data-filter="untagged"] .count');
        if (untaggedCount) untaggedCount.textContent = accounts.filter(a => !a.tags || a.tags.length === 0).length;
        
        // Update tag counters
        const tags = dataStore.getTags();
        tags.forEach(tag => {
            const tagCount = document.querySelector(`[data-tag-id="${tag.id}"] .count`);
            if (tagCount) {
                tagCount.textContent = accounts.filter(a => a.tags.includes(tag.id)).length;
            }
        });
    }

    /**
     * Render sidebar with tags (with memoization to avoid unnecessary re-renders)
     */
    renderSidebar() {
        const tagsContainer = document.getElementById('tagsContainer');
        if (!tagsContainer) return;

        const tags = dataStore.getTags();
        const accounts = dataStore.getAccounts();

        // Memoization: check if state has changed
        const currentState = JSON.stringify({
            tagIds: tags.map(t => t.id),
            tagNames: tags.map(t => t.name),
            accountCount: accounts.length,
            statusFilter: searchManager.statusFilter,
            selectedTags: searchManager.selectedTags,
            showUntagged: searchManager.showUntagged
        });

        if (this.lastSidebarState === currentState) {
            // State hasn't changed - only update counters
            this.updateSidebarCounts();
            return;
        }

        this.lastSidebarState = currentState;

        // Full sidebar re-render (only if state has changed)
        tagsContainer.innerHTML = `
            <div class="sidebar-section">
                <h4>FILTERS</h4>
                <div class="filter-item ${searchManager.statusFilter === 'all' ? 'active' : ''}" data-filter="all">
                    <span>📊 All Accounts</span>
                    <span class="count">${accounts.length}</span>
                </div>
                <div class="filter-item ${searchManager.statusFilter === 'favorite' ? 'active' : ''}" data-filter="favorite">
                    <span>⭐ Favorites</span>
                    <span class="count">${accounts.filter(a => a.favorite).length}</span>
                </div>
                <div class="filter-item ${searchManager.statusFilter === 'active' ? 'active' : ''}" data-filter="active">
                    <span>✅ Active</span>
                    <span class="count">${accounts.filter(a => !a.completed).length}</span>
                </div>
                <div class="filter-item ${searchManager.statusFilter === 'completed' ? 'active' : ''}" data-filter="completed">
                    <span>❌ Completed</span>
                    <span class="count">${accounts.filter(a => a.completed).length}</span>
                </div>
            </div>

            <div class="sidebar-section">
                <h4>TAGS</h4>
                <div class="tag-filter-item ${searchManager.showUntagged ? 'active' : ''}" data-filter="untagged">
                    <span>📭 Untagged</span>
                    <span class="count">${accounts.filter(a => !a.tags || a.tags.length === 0).length}</span>
                </div>
                ${tags.map(tag => {
                    const count = accounts.filter(a => a.tags.includes(tag.id)).length;
                    const isActive = searchManager.selectedTags.includes(tag.id);
                    return `
                        <div class="tag-filter-item ${isActive ? 'active' : ''}" data-tag-id="${tag.id}">
                            <span class="tag-pill" style="background-color: ${tag.color}20; border-color: ${tag.color}">${tag.name}</span>
                            <span class="count">${count}</span>
                        </div>
                    `;
                }).join('')}
                <button class="btn-new-tag" id="btnNewTag">+ New Tag</button>
            </div>
        `;

        // IMPORTANT: DON'T create event listeners here - they are set up once in setupSidebarEventDelegation()
        
        // Initialize only drop zones for drag & drop (these are not event listeners)
        tagsContainer.querySelectorAll('.tag-filter-item[data-tag-id]').forEach(item => {
            this.dragDropManager.initTagDropZone(item.dataset.tagId, item);
        });

        // Initialize drop zone for "Untagged" filter
        const untaggedFilter = tagsContainer.querySelector('.tag-filter-item[data-filter="untagged"]');
        if (untaggedFilter) {
            this.dragDropManager.initFilterDropZone(untaggedFilter, 'untagged');
        }

        tagsContainer.querySelectorAll('.filter-item').forEach(item => {
            const filterType = item.dataset.filter;
            if (filterType === 'favorite' || filterType === 'completed' || filterType === 'active') {
                this.dragDropManager.initFilterDropZone(item, filterType);
            }
        });

        // Update drop zone element cache for drag & drop performance
        this.dragDropManager.updateDropZoneCache();
        
        // Update custom scrollbar after content change
        if (window.customScrollbar) {
            setTimeout(() => window.customScrollbar.updateThumb(), 0);
        }
    }

    /**
     * Setup event delegation for sidebar (ONE listener instead of hundreds)
     * Called ONCE during init - prevents memory leaks
     * CRITICAL FIX: This prevents 1500-2000 leaked listeners
     */
    setupSidebarEventDelegation() {
        const tagsContainer = document.getElementById('tagsContainer');
        if (!tagsContainer) return;

        // ONE listener for all clicks in sidebar
        tagsContainer.addEventListener('click', (e) => {
            // Filter items
            const filterItem = e.target.closest('.filter-item');
            if (filterItem) {
                searchManager.setStatusFilter(filterItem.dataset.filter);
                this.render();
                return;
            }

            // Tag filter items
            const tagItem = e.target.closest('.tag-filter-item');
            if (tagItem) {
                if (tagItem.dataset.filter === 'untagged') {
                    searchManager.toggleUntagged();
                } else if (tagItem.dataset.tagId) {
                    searchManager.toggleTag(tagItem.dataset.tagId);
                }
                this.render();
                return;
            }

            // New tag button
            if (e.target.closest('#btnNewTag')) {
                const modal = new TagModal();
                modal.show();
                return;
            }
        });

        // ONE listener for all context menus in sidebar
        tagsContainer.addEventListener('contextmenu', (e) => {
            const tagItem = e.target.closest('.tag-filter-item[data-tag-id]');
            if (tagItem) {
                e.preventDefault();
                this.showTagContextMenu(e, tagItem.dataset.tagId);
            }
        });
    }

    /**
     * Show context menu for tag (right-click)
     */
    showTagContextMenu(event, tagId) {
        // Remove existing menu if present
        const existingMenu = document.querySelector('.tag-context-menu');
        if (existingMenu) {
            document.body.removeChild(existingMenu);
        }

        const tag = dataStore.getTag(tagId);
        if (!tag) return;

        // Create context menu
        const menu = document.createElement('div');
        menu.className = 'tag-context-menu';
        menu.innerHTML = `
            <div class="context-menu-item" data-action="edit">
                <span>✏️ Edit Tag</span>
            </div>
            <div class="context-menu-item context-menu-item-danger" data-action="delete">
                <span>🗑️ Delete Tag</span>
            </div>
        `;

        // Position menu
        menu.style.position = 'fixed';
        menu.style.left = `${event.clientX}px`;
        menu.style.top = `${event.clientY}px`;

        document.body.appendChild(menu);

        // Appearance animation
        setTimeout(() => menu.classList.add('show'), 10);

        // Handlers
        menu.querySelector('[data-action="edit"]').addEventListener('click', () => {
            const modal = new TagModal(tagId);
            modal.show();
            document.body.removeChild(menu);
        });

        menu.querySelector('[data-action="delete"]').addEventListener('click', () => {
            const accountsWithTag = dataStore.getAccounts().filter(a => a.tags.includes(tagId));
            const confirmMsg = accountsWithTag.length > 0
                ? `Delete tag "${tag.name}"? It will be removed from ${accountsWithTag.length} account(s).`
                : `Delete tag "${tag.name}"?`;
            
            const deleteModal = new Modal({
                title: 'Delete Tag?',
                content: `<p>${confirmMsg}</p>`,
                confirmText: 'Delete',
                cancelText: 'Cancel',
                onConfirm: () => {
                    dataStore.deleteTag(tagId);
                    notificationManager.show('Tag deleted');
                    this.render();
                }
            });
            deleteModal.show();
            document.body.removeChild(menu);
        });

        // Close on click outside menu
        const closeMenu = (e) => {
            if (!menu.contains(e.target)) {
                if (document.body.contains(menu)) {
                    document.body.removeChild(menu);
                }
                document.removeEventListener('click', closeMenu);
            }
        };
        setTimeout(() => document.addEventListener('click', closeMenu), 100);
    }

    /**
     * Render accounts list (optimized - lazy initialization, no full re-render)
     */
    renderAccounts() {
        const container = document.getElementById('credentialsList');
        if (!container) return;

        const accounts = searchManager.getFilteredAccounts();

        if (accounts.length === 0) {
            container.innerHTML = `
                <div class="no-data">
                    <h3>No accounts found</h3>
                    <p>Try adjusting your filters or add a new account</p>
                </div>
            `;
            this.cleanupBeforeRender();
            return;
        }

        // Clear old references before new render (critical for memory)
        this.cleanupBeforeRender();

        // Use DocumentFragment for efficient insertion
        const fragment = document.createDocumentFragment();
        const newRenderedAccounts = new Map();
        const currentAccountIds = new Set(accounts.map(a => a.id));

        accounts.forEach(account => {
            const cardHTML = this.renderAccountCard(account);
            const tempDiv = document.createElement('div');
            tempDiv.innerHTML = cardHTML;
            const cardElement = tempDiv.firstElementChild;
            
            fragment.appendChild(cardElement);
            newRenderedAccounts.set(account.id, cardElement);
        });

        // One insertion operation instead of multiple
        container.innerHTML = '';
        container.appendChild(fragment);

        this.renderedAccounts = newRenderedAccounts;

        // Clear visibleCards from deleted accounts
        for (const accountId of this.visibleCards) {
            if (!currentAccountIds.has(accountId)) {
                this.visibleCards.delete(accountId);
            }
        }

        // Connect IntersectionObserver to all cards
        // Drag & drop will be initialized only for visible ones (in observer callback)
        this.renderedAccounts.forEach((cardElement) => {
            if (this.intersectionObserver) {
                this.intersectionObserver.observe(cardElement);
            }
        });
    }

    /**
     * Cleanup before render to prevent memory leaks
     */
    cleanupBeforeRender() {
        // Disconnect observer from all old elements
        if (this.intersectionObserver) {
            this.renderedAccounts.forEach((cardElement) => {
                this.intersectionObserver.unobserve(cardElement);
            });
        }

        // Clear Map with DOM elements (free memory)
        this.renderedAccounts.clear();
        
        // CRITICAL: Clear visibleCards so drag is initialized again
        // After render new DOM elements are created, and drag needs to be initialized again
        this.visibleCards.clear();
    }


    /**
     * Render single account card
     */
    renderAccountCard(account) {
        const tags = account.tags.map(tagId => {
            const tag = dataStore.getTag(tagId);
            return tag ? `<span class="tag-pill" style="background-color: ${tag.color}20; border-color: ${tag.color}">${tag.name}</span>` : '';
        }).join('');

        const username = account.extras.length > 0 ? account.extras.join(', ') : 'No description';

        return `
            <div class="credential ${account.completed ? 'completed' : ''}" data-account-id="${account.id}">
                <div class="drag-handle" title="Drag to reorder or add to tag">⋮⋮</div>
                
                <div class="credential-content">
                    <div class="credential-header">
                        <div class="username ${!account.extras.length ? 'placeholder' : ''}" data-action="copy-username">
                            ${username}
                        </div>
                        ${tags ? `<div class="tags-container">${tags}</div>` : ''}
                    </div>

                    <div class="credential-main">
                        <div class="credential-item email-item" data-action="copy-email">
                            <div class="item-label">EMAIL</div>
                            <div class="item-value">${account.email}</div>
                        </div>

                        <div class="credential-item password-item" data-action="copy-password">
                            <div class="item-label">PASSWORD</div>
                            <div class="item-value">••••••••</div>
                        </div>

                        <div class="credential-item totp-item ${!account.totp ? 'totp-disabled' : ''}" data-action="copy-totp" data-totp-secret="${account.totp}">
                            <div class="item-label">TOTP</div>
                            <div class="item-value totp-code">------</div>
                        </div>
                    </div>
                </div>
                
                <div class="credential-actions-right">
                    <div class="actions-column">
                        <button class="action-btn-right" data-action="toggle-completed" title="${account.completed ? 'Mark as active' : 'Mark as completed'}">
                            ${account.completed ? '❌' : '✅'}
                        </button>
                        <button class="action-btn-right" data-action="quick-tag" title="Add tag">🏷️</button>
                        <button class="action-btn-right" data-action="favorite" title="Toggle favorite">${account.favorite ? '💖' : '🤍'}</button>
                    </div>
                    <div class="actions-column">
                        <button class="action-btn-right" data-action="edit" title="Edit">✏️</button>
                        <button class="action-btn-right" data-action="delete" title="Delete">🗑️</button>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Start TOTP updates with precise timing (only for visible cards)
     */
    startTOTPUpdates() {
        // Update immediately on start (only visible)
        this.updateVisibleTOTPs();
        
        // Function to schedule next update
        const scheduleNextUpdate = () => {
            const now = Date.now();
            const currentSecond = Math.floor(now / 1000);
            const currentWindow = Math.floor(currentSecond / 30);
            const nextWindowStart = (currentWindow + 1) * 30;
            const msUntilNextWindow = (nextWindowStart * 1000) - now;
            
            // Schedule update exactly at the moment of 30-second window change
            this.totpUpdateInterval = setTimeout(() => {
                this.updateVisibleTOTPs(); // Only visible cards
                TOTP.cleanCache(); // Clean cache on window change
                scheduleNextUpdate(); // Schedule next update
            }, msUntilNextWindow);
        };
        
        scheduleNextUpdate();
    }

    /**
     * Update TOTP code for a single card
     */
    async updateCardTOTP(cardElement) {
        const totpElement = cardElement.querySelector('.totp-item');
        if (!totpElement) return;

        const secret = totpElement.dataset.totpSecret;
        // Skip accounts without TOTP (empty string)
        if (secret && secret.trim()) {
            const code = await TOTP.generate(secret);
            const codeElement = totpElement.querySelector('.totp-code');
            if (codeElement) {
                codeElement.textContent = code;
            }
        }
        // If no TOTP, leave "------" gray (via CSS class totp-disabled)
    }

    /**
     * Update TOTP codes ONLY for visible cards (critical performance optimization)
     */
    async updateVisibleTOTPs() {
        // NEVER update all cards - only visible ones
        if (this.visibleCards.size === 0) {
            // If no visible cards, just exit
            return;
        }

        // Update only visible cards in batch
        const updatePromises = [];
        for (const accountId of this.visibleCards) {
            const cardElement = this.renderedAccounts.get(accountId);
            if (cardElement && document.body.contains(cardElement)) {
                updatePromises.push(this.updateCardTOTP(cardElement));
            }
        }
        
        await Promise.all(updatePromises);
    }
}

// ============================================================================
// GLOBAL INSTANCES
// ============================================================================

const dataStore = new DataStore();
const notificationManager = new NotificationManager();
const searchManager = new SearchManager();
const dragDropManager = new DragDropManager();

// Export for use in other parts of the application
window.CredentialsManager = {
    dataStore,
    notificationManager,
    searchManager,
    dragDropManager,
    Modal,
    ImportModal,
    ExportModal,
    AccountModal,
    DeleteAccountModal,
    TagModal,
    QuickTagSelector,
    DragDropManager,
    FileParser,
    TOTP,
    Clipboard,
    Utils,
    Storage
};

// ============================================================================
// CUSTOM SCROLLBAR
// ============================================================================

class CustomScrollbar {
    constructor(container, content, scrollbar, thumb) {
        this.container = container;
        this.content = content;
        this.scrollbar = scrollbar;
        this.thumb = thumb;
        this.isDragging = false;
        this.startY = 0;
        this.startScrollTop = 0;
        
        this.init();
    }
    
    init() {
        // Update scrollbar on content scroll
        this.content.addEventListener('scroll', () => this.updateThumb());
        
        // Drag thumb
        this.thumb.addEventListener('mousedown', (e) => this.startDrag(e));
        document.addEventListener('mousemove', (e) => this.onDrag(e));
        document.addEventListener('mouseup', () => this.stopDrag());
        
        // Click on track
        this.scrollbar.addEventListener('click', (e) => {
            if (e.target === this.scrollbar) {
                const rect = this.scrollbar.getBoundingClientRect();
                const clickY = e.clientY - rect.top;
                const thumbHeight = this.thumb.offsetHeight;
                const scrollbarHeight = this.scrollbar.clientHeight; // FIX: use scrollbar height
                const scrollRatio = (clickY - thumbHeight / 2) / (scrollbarHeight - thumbHeight);
                this.content.scrollTop = scrollRatio * (this.content.scrollHeight - this.content.clientHeight);
            }
        });
        
        // Update on resize
        window.addEventListener('resize', () => this.updateThumb());
        
        // Initial update
        this.updateThumb();
    }
    
    updateThumb() {
        const contentHeight = this.content.clientHeight;
        const scrollHeight = this.content.scrollHeight;
        const scrollTop = this.content.scrollTop;
        
        // Hide scrollbar if content fits
        if (scrollHeight <= contentHeight) {
            this.scrollbar.style.opacity = '0';
            return;
        }
        
        this.scrollbar.style.opacity = '1';
        
        // FIX: use scrollbar height (accounting for top/bottom margins)
        const scrollbarHeight = this.scrollbar.clientHeight;
        
        // Thumb size proportional to visible part
        const thumbHeight = Math.max(30, (contentHeight / scrollHeight) * scrollbarHeight);
        this.thumb.style.height = thumbHeight + 'px';
        
        // Thumb position (now relative to scrollbar, not content)
        const maxScroll = scrollHeight - contentHeight;
        const scrollRatio = scrollTop / maxScroll;
        const maxThumbTop = scrollbarHeight - thumbHeight;
        this.thumb.style.top = (scrollRatio * maxThumbTop) + 'px';
    }
    
    startDrag(e) {
        this.isDragging = true;
        this.startY = e.clientY;
        this.startScrollTop = this.content.scrollTop;
        this.thumb.style.cursor = 'grabbing';
        e.preventDefault();
    }
    
    onDrag(e) {
        if (!this.isDragging) return;
        
        const deltaY = e.clientY - this.startY;
        const scrollbarHeight = this.scrollbar.clientHeight; // FIX: use scrollbar height
        const contentHeight = this.content.clientHeight;
        const scrollHeight = this.content.scrollHeight;
        const thumbHeight = this.thumb.offsetHeight;
        const maxThumbTop = scrollbarHeight - thumbHeight; // FIX: relative to scrollbar
        const scrollRatio = deltaY / maxThumbTop;
        
        this.content.scrollTop = this.startScrollTop + scrollRatio * (scrollHeight - contentHeight);
    }
    
    stopDrag() {
        this.isDragging = false;
        this.thumb.style.cursor = 'pointer';
    }
}

// ============================================================================
// INITIALIZE APPLICATION
// ============================================================================

let app;
let customScrollbar;

document.addEventListener('DOMContentLoaded', () => {
    app = new CredentialsApp();
    window.app = app; // Make available globally for modals
    
    // Initialize custom scrollbar for sidebar
    const sidebar = document.querySelector('.sidebar');
    const sidebarContent = document.querySelector('.sidebar-content');
    const scrollbar = document.querySelector('.custom-scrollbar');
    const thumb = document.querySelector('.custom-scrollbar-thumb');
    
    if (sidebar && sidebarContent && scrollbar && thumb) {
        customScrollbar = new CustomScrollbar(sidebar, sidebarContent, scrollbar, thumb);
        window.customScrollbar = customScrollbar; // Make globally available
        
        // Function to handle wheel on entire sidebar area (including padding and scrollbar)
        const handleSidebarWheel = (e) => {
            e.preventDefault(); // Always block default behavior
            
            const scrollTop = sidebarContent.scrollTop;
            const scrollHeight = sidebarContent.scrollHeight;
            const clientHeight = sidebarContent.clientHeight;
            const deltaY = e.deltaY;
            
            // Check scroll boundaries
            const isAtTop = scrollTop === 0;
            const isAtBottom = scrollTop + clientHeight >= scrollHeight - 1;
            
            // If not at boundary - scroll programmatically
            if (!(isAtTop && deltaY < 0) && !(isAtBottom && deltaY > 0)) {
                sidebarContent.scrollTop += deltaY;
            }
            // If at boundary - just do nothing (don't pass scroll further)
        };
        
        // Attach handler to entire sidebar (including padding)
        sidebar.addEventListener('wheel', handleSidebarWheel, { passive: false });
        
        // Attach handler to scrollbar (so scroll works on it too)
        scrollbar.addEventListener('wheel', handleSidebarWheel, { passive: false });
    }
});
