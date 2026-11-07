import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView, Platform, ActivityIndicator } from 'react-native';
import { api, BACKEND_URL } from '@/services/api';

interface Track {
  id: string;
  title: string;
  artist?: string;
  audioUrl: string;
  coverImageUrl?: string;
  duration?: number;
  isDefault?: boolean;
}

export const MeditationModule: React.FC = () => {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentTrack, setCurrentTrack] = useState<Track | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [volume, setVolume] = useState(1);

  // Default Music state
  const [defaultMusicId, setDefaultMusicId] = useState<string | null>(null);

  // Upload modal state
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState('');
  const [setAsDefaultOnUpload, setSetAsDefaultOnUpload] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Initial load of default music setting
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      const savedDefaultId = window.localStorage.getItem('vyom_default_music_id');
      if (savedDefaultId) {
        setDefaultMusicId(savedDefaultId);
      }
    }
  }, []);

  const handleSetDefaultMusic = async (trackId: string | null, e?: any) => {
    if (e && e.stopPropagation) {
      e.stopPropagation();
    }
    setDefaultMusicId(trackId);
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
      if (trackId) {
        window.localStorage.setItem('vyom_default_music_id', trackId);
      } else {
        window.localStorage.removeItem('vyom_default_music_id');
      }
    }

    // Persist default music selection in backend database
    try {
      await fetch(`${BACKEND_URL}/api/music/set-default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: trackId }),
      });
    } catch (err) {
      console.error('Failed to sync default music to backend database:', err);
    }
  };

  // Fetch tracks from backend using Arri Client (api.yoga.getMusicList)
  const fetchTracks = async () => {
    try {
      setLoading(true);
      const res = await api.yoga.getMusicList({});
      const list = (res.musicList || []) as Track[];
      if (res.success || Array.isArray(list)) {
        setTracks(list);

        // Find backend default track
        const dbDefault = list.find((t) => t.isDefault);
        if (dbDefault && !defaultMusicId) {
          setDefaultMusicId(dbDefault.id);
        }

        let targetDefaultId: string | null = defaultMusicId || (dbDefault ? dbDefault.id : null);
        if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
          targetDefaultId = window.localStorage.getItem('vyom_default_music_id') || targetDefaultId;
        }

        const matchedDefault = targetDefaultId ? list.find((t) => t.id === targetDefaultId) : null;

        if (matchedDefault) {
          setCurrentTrack(matchedDefault);
        } else if (list.length > 0 && !currentTrack) {
          setCurrentTrack(list[0]);
        }
      }
    } catch (err) {
      console.error('Error fetching meditation tracks via Arri Client:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTracks();
  }, []);

  // Audio setup for Web
  useEffect(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const audio = new Audio();
      audioRef.current = audio;

      const handleLoadedMetadata = () => {
        setDuration(audio.duration || 0);
      };

      const handleTimeUpdate = () => {
        setCurrentTime(audio.currentTime || 0);
      };

      const handleEnded = () => {
        setIsPlaying(false);
        setCurrentTime(0);
      };

      audio.addEventListener('loadedmetadata', handleLoadedMetadata);
      audio.addEventListener('timeupdate', handleTimeUpdate);
      audio.addEventListener('ended', handleEnded);

      return () => {
        audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
        audio.removeEventListener('timeupdate', handleTimeUpdate);
        audio.removeEventListener('ended', handleEnded);
        audio.pause();
      };
    }
  }, []);

  // Update audio source when track changes
  useEffect(() => {
    if (audioRef.current && currentTrack) {
      let fullUrl = currentTrack.audioUrl;
      if (fullUrl && !fullUrl.startsWith('http')) {
        fullUrl = `${BACKEND_URL}${fullUrl}`;
      }
      audioRef.current.src = fullUrl;
      setCurrentTime(0);
      if (isPlaying) {
        audioRef.current.play().catch((e) => console.error('Play error:', e));
      }
    }
  }, [currentTrack]);

  const togglePlayPause = () => {
    if (!audioRef.current || !currentTrack) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch((e) => console.error('Play error:', e));
    }
  };

  const handleSeek = (e: any) => {
    const val = parseFloat(e.target.value);
    setCurrentTime(val);
    if (audioRef.current) {
      audioRef.current.currentTime = val;
    }
  };

  const handleVolumeChange = (e: any) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (audioRef.current) {
      audioRef.current.volume = val;
    }
  };

  const handleSelectTrack = (track: Track) => {
    setCurrentTrack(track);
    setIsPlaying(true);
    if (audioRef.current) {
      let fullUrl = track.audioUrl;
      if (fullUrl && !fullUrl.startsWith('http')) {
        fullUrl = `${BACKEND_URL}${fullUrl}`;
      }
      audioRef.current.src = fullUrl;
      audioRef.current.play().then(() => setIsPlaying(true)).catch((e) => console.error('Play error:', e));
    }
  };

  const handleFileChange = (e: any) => {
    if (e.target.files && e.target.files[0]) {
      setSelectedFile(e.target.files[0]);
    }
  };

  const handleUploadSubmit = async () => {
    if (!selectedFile || !newTitle.trim()) {
      setUploadError('Please enter a track name and select an audio file.');
      return;
    }
    setUploadError('');
    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('title', newTitle.trim());
      formData.append('artist', 'Vyom Meditation');

      const response = await fetch(`${BACKEND_URL}/api/music/upload`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();
      if (data.success) {
        setShowUploadModal(false);
        setNewTitle('');
        setSelectedFile(null);

        if (setAsDefaultOnUpload && data.track?.id) {
          handleSetDefaultMusic(data.track.id);
        }

        await fetchTracks();
        if (data.track) {
          handleSelectTrack(data.track);
        }
      } else {
        setUploadError(data.message || 'Upload failed');
      }
    } catch (err: any) {
      setUploadError(err.message || 'Network error during upload');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteTrack = async (trackId: string, trackTitle: string, e?: any) => {
    if (e && e.stopPropagation) {
      e.stopPropagation();
    }
    const proceed = Platform.OS === 'web'
      ? window.confirm(`Are you sure you want to delete "${trackTitle}"?`)
      : true;

    if (!proceed) return;

    try {
      const res = await api.yoga.deleteMusic({ id: trackId });
      if (res.success) {
        if (defaultMusicId === trackId) {
          handleSetDefaultMusic(null);
        }
        if (currentTrack?.id === trackId) {
          if (audioRef.current) {
            audioRef.current.pause();
            setIsPlaying(false);
          }
          setCurrentTrack(null);
        }
        fetchTracks();
      } else {
        alert(res.message || 'Failed to delete track');
      }
    } catch (err) {
      console.error('Error deleting track:', err);
      alert('Error deleting track');
    }
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const defaultTrack = tracks.find((t) => t.id === defaultMusicId);

  return (
    <View style={styles.container}>
      {/* Header Banner */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Meditation & Soundscapes</Text>
          <Text style={styles.subtitle}>Stream tranquil audio tracks for deep focus & mindfulness</Text>
        </View>
        <Pressable style={styles.uploadButton} onPress={() => setShowUploadModal(true)}>
          <Text style={styles.uploadButtonText}>+ Upload Music</Text>
        </Pressable>
      </View>

      {/* Default Music Configurator Card */}
      <View style={styles.defaultConfigCard}>
        <View style={styles.defaultConfigInfo}>
          <Text style={styles.defaultConfigIcon}>⭐</Text>
          <View>
            <Text style={styles.defaultConfigTitle}>Default Music Configuration</Text>
            <Text style={styles.defaultConfigSubtitle}>
              {defaultTrack
                ? `Current Default: "${defaultTrack.title}"`
                : 'No default track selected. Select a track below to play automatically on start.'}
            </Text>
          </View>
        </View>
        {Platform.OS === 'web' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ fontSize: '12px', color: '#4b5563', fontWeight: 600 }}>Default Track:</span>
            <select
              value={defaultMusicId || ''}
              onChange={(e) => handleSetDefaultMusic(e.target.value || null)}
              style={selectStyles.dropdown}
            >
              <option value="">-- None (Play First Available) --</option>
              {tracks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.title} {t.artist ? `(${t.artist})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
      </View>

      {/* Main Content Area */}
      <View style={styles.contentLayout}>
        {/* Currently Playing Card */}
        <View style={styles.playerCard}>
          <View style={styles.artworkContainer}>
            <View style={[styles.glowRing, isPlaying && styles.glowRingActive]} />
            <img
              src={
                currentTrack?.coverImageUrl ||
                'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=500&auto=format&fit=crop'
              }
              alt="Track Artwork"
              style={{
                width: '180px',
                height: '180px',
                borderRadius: '90px',
                objectFit: 'cover',
                border: '3px solid rgba(0, 204, 153, 0.4)',
                boxShadow: isPlaying ? '0 0 30px rgba(0, 204, 153, 0.3)' : 'none',
                transition: 'all 0.5s ease',
              }}
            />
          </View>

          <Text style={styles.trackTitle}>{currentTrack ? currentTrack.title : 'Select a track'}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <Text style={styles.trackArtist}>{currentTrack ? (currentTrack.artist || 'Vyom Meditation') : 'Meditation'}</Text>
            {currentTrack?.id === defaultMusicId && (
              <View style={styles.defaultBadge}>
                <Text style={styles.defaultBadgeText}>⭐ Default Music</Text>
              </View>
            )}
          </View>

          {/* Seek Bar */}
          {Platform.OS === 'web' && (
            <div style={{ width: '100%', marginTop: '20px', marginBottom: '10px' }}>
              <input
                type="range"
                min="0"
                max={duration || 100}
                value={currentTime}
                onChange={handleSeek}
                style={{
                  width: '100%',
                  accentColor: '#00cc99',
                  cursor: 'pointer',
                }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', color: '#6b7280', fontSize: '12px' }}>
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
          )}

          {/* Player Controls */}
          <View style={styles.controlsRow}>
            <Pressable style={styles.playButton} onPress={togglePlayPause}>
              <Text style={styles.playIcon}>{isPlaying ? '⏸' : '▶'}</Text>
            </Pressable>
          </View>

          {/* Volume Control */}
          {Platform.OS === 'web' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '16px' }}>
              <span style={{ color: '#6b7280', fontSize: '14px' }}>🔊</span>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={volume}
                onChange={handleVolumeChange}
                style={{ width: '80px', accentColor: '#00cc99', cursor: 'pointer' }}
              />
            </div>
          )}
        </View>

        {/* Music Track List */}
        <View style={styles.listContainer}>
          <Text style={styles.sectionHeader}>DB Music Library ({tracks.length})</Text>
          {loading ? (
            <ActivityIndicator size="large" color="#00cc99" style={{ marginTop: 40 }} />
          ) : tracks.length === 0 ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>No music tracks found in DB.</Text>
              <Text style={styles.emptySubtext}>Click "+ Upload Music" above to add your stream-optimized audio!</Text>
            </View>
          ) : (
            <ScrollView style={{ flex: 1 }}>
              {tracks.map((track, idx) => {
                const isSelected = currentTrack?.id === track.id;
                const isDefault = defaultMusicId === track.id;
                return (
                  <Pressable
                    key={track.id || idx}
                    style={[styles.trackItem, isSelected && styles.trackItemActive]}
                    onPress={() => handleSelectTrack(track)}
                  >
                    <View style={styles.trackThumb}>
                      <Text style={{ fontSize: 18 }}>🎵</Text>
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={[styles.itemTitle, isSelected && { color: '#009970' }]}>
                          {track.title}
                        </Text>
                        {isDefault && (
                          <View style={styles.defaultBadge}>
                            <Text style={styles.defaultBadgeText}>⭐ Default</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.itemArtist}>{track.artist || 'Vyom Meditation'}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Pressable
                        onPress={(e) => handleSetDefaultMusic(isDefault ? null : track.id, e)}
                        style={[styles.setDefaultButton, isDefault && styles.setDefaultButtonActive]}
                      >
                        <Text style={[styles.setDefaultButtonText, isDefault && styles.setDefaultButtonTextActive]}>
                          {isDefault ? '★ Default' : '☆ Set Default'}
                        </Text>
                      </Pressable>
                      <Text style={styles.streamBadge}>Stream Ready</Text>
                      <Pressable
                        onPress={(e) => handleDeleteTrack(track.id, track.title, e)}
                        style={styles.deleteTrackButton}
                      >
                        <Text style={{ fontSize: 14, color: '#ef4444' }}>🗑️</Text>
                      </Pressable>
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      </View>

      {/* Upload Music Modal */}
      {showUploadModal && Platform.OS === 'web' && (
        <div style={modalStyles.overlay}>
          <div style={modalStyles.card}>
            <h3 style={modalStyles.title}>Upload Meditation Music</h3>
            <p style={modalStyles.description}>
              Upload audio files (MP3, WAV, M4A). The server will process a stream-efficient version for instant frontend streaming.
            </p>

            {uploadError ? (
              <div style={{ padding: '10px 14px', borderRadius: '8px', backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', fontSize: '13px', marginBottom: '18px', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
                {uploadError}
              </div>
            ) : null}

            <div style={{ marginBottom: '16px' }}>
              <label style={modalStyles.label}>Track Name</label>
              <input
                type="text"
                placeholder="Enter track name..."
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                style={modalStyles.input}
              />
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={modalStyles.label}>Audio File</label>
              <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              <div
                onClick={() => fileInputRef.current?.click()}
                style={modalStyles.fileDropzone}
              >
                <span style={{ fontSize: '24px', marginRight: '12px' }}>🎵</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '13px', fontWeight: '600', color: selectedFile ? '#009970' : '#111827' }}>
                    {selectedFile ? selectedFile.name : 'Click to select audio file'}
                  </span>
                  <span style={{ fontSize: '11px', color: '#6b7280' }}>
                    {selectedFile ? `${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB` : 'Supports MP3, WAV, M4A'}
                  </span>
                </div>
              </div>
            </div>

            <div style={{ marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <input
                type="checkbox"
                id="setDefaultCheckbox"
                checked={setAsDefaultOnUpload}
                onChange={(e) => setSetAsDefaultOnUpload(e.target.checked)}
                style={{ accentColor: '#00cc99', width: '16px', height: '16px', cursor: 'pointer' }}
              />
              <label htmlFor="setDefaultCheckbox" style={{ fontSize: '13px', color: '#374151', cursor: 'pointer', fontWeight: '500' }}>
                Set as Default Music after upload
              </label>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
              <button
                onClick={() => setShowUploadModal(false)}
                disabled={uploading}
                style={modalStyles.cancelButton}
              >
                Cancel
              </button>
              <button
                onClick={handleUploadSubmit}
                disabled={uploading}
                style={modalStyles.submitButton}
              >
                {uploading ? 'Processing Stream...' : 'Upload & Process'}
              </button>
            </div>
          </div>
        </div>
      )}
    </View>
  );
};

const modalStyles = {
  overlay: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
    backdropFilter: 'blur(8px)',
    WebkitBackdropFilter: 'blur(8px)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 20000,
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: '20px',
    padding: '28px 32px',
    maxWidth: '440px',
    width: '90%',
    boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
    border: '1px solid #e5e7eb',
    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  title: {
    color: '#111827',
    margin: '0 0 8px 0',
    fontSize: '20px',
    fontWeight: '700',
    fontFamily: 'inherit',
    letterSpacing: '-0.02em',
  },
  description: {
    color: '#6b7280',
    fontSize: '13px',
    marginBottom: '24px',
    lineHeight: '1.5',
    fontFamily: 'inherit',
  },
  label: {
    display: 'block',
    color: '#374151',
    fontSize: '13px',
    fontWeight: '600',
    marginBottom: '6px',
    fontFamily: 'inherit',
  },
  input: {
    width: '100%',
    padding: '10px 14px',
    borderRadius: '10px',
    backgroundColor: '#f9fafb',
    border: '1px solid #d1d5db',
    color: '#111827',
    fontSize: '14px',
    outline: 'none',
    boxSizing: 'border-box' as const,
    fontFamily: 'inherit',
  },
  fileDropzone: {
    display: 'flex',
    alignItems: 'center',
    padding: '14px 16px',
    borderRadius: '12px',
    backgroundColor: '#f9fafb',
    border: '2px dashed #d1d5db',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.2s ease',
  },
  cancelButton: {
    padding: '9px 20px',
    borderRadius: '20px',
    backgroundColor: '#ffffff',
    border: '1px solid #d1d5db',
    color: '#374151',
    fontWeight: '600',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  submitButton: {
    padding: '9px 24px',
    borderRadius: '20px',
    backgroundColor: '#00cc99',
    border: 'none',
    color: '#ffffff',
    fontWeight: '700',
    fontSize: '13px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    boxShadow: '0 4px 12px rgba(0, 204, 153, 0.3)',
  },
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#ffffff',
    padding: 24,
    minHeight: '100%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
  },
  subtitle: {
    fontSize: 13,
    color: '#6b7280',
    marginTop: 4,
  },
  uploadButton: {
    backgroundColor: '#00cc99',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 24,
  },
  uploadButtonText: {
    color: '#ffffff',
    fontWeight: 'bold',
    fontSize: 13,
  },
  contentLayout: {
    flexDirection: Platform.OS === 'web' ? 'row' : 'column',
    gap: 24,
    flex: 1,
  },
  playerCard: {
    flex: 1,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 28,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 16,
  },
  artworkContainer: {
    position: 'relative',
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glowRing: {
    position: 'absolute',
    width: 210,
    height: 210,
    borderRadius: 105,
    backgroundColor: 'rgba(0, 204, 153, 0.05)',
  },
  glowRingActive: {
    backgroundColor: 'rgba(0, 204, 153, 0.15)',
  },
  trackTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    marginTop: 8,
    textAlign: 'center',
  },
  trackArtist: {
    fontSize: 14,
    color: '#009970',
    marginTop: 4,
    textAlign: 'center',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
  },
  playButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#00cc99',
    justifyContent: 'center',
    alignItems: 'center',
  },
  playIcon: {
    fontSize: 24,
    color: '#ffffff',
  },
  listContainer: {
    flex: 1.2,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 16,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    color: '#111827',
    fontSize: 15,
    fontWeight: 'bold',
  },
  emptySubtext: {
    color: '#6b7280',
    fontSize: 13,
    marginTop: 6,
  },
  trackItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    backgroundColor: '#f9fafb',
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  trackItemActive: {
    backgroundColor: 'rgba(0, 204, 153, 0.08)',
    borderColor: 'rgba(0, 204, 153, 0.4)',
  },
  trackThumb: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 204, 153, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  itemTitle: {
    color: '#111827',
    fontSize: 14,
    fontWeight: '600',
  },
  itemArtist: {
    color: '#6b7280',
    fontSize: 12,
    marginTop: 2,
  },
  streamBadge: {
    fontSize: 10,
    color: '#008a67',
    backgroundColor: 'rgba(0, 204, 153, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    fontWeight: '600',
  },
  deleteTrackButton: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.08)',
    marginLeft: 6,
  },
  defaultConfigCard: {
    backgroundColor: '#f8fafc',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    flexDirection: Platform.OS === 'web' ? 'row' : 'column',
    alignItems: Platform.OS === 'web' ? 'center' : 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  defaultConfigInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  defaultConfigIcon: {
    fontSize: 22,
  },
  defaultConfigTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0f172a',
  },
  defaultConfigSubtitle: {
    fontSize: 12,
    color: '#64748b',
    marginTop: 2,
  },
  defaultBadge: {
    backgroundColor: 'rgba(245, 158, 11, 0.12)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.3)',
  },
  defaultBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#d97706',
  },
  setDefaultButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#f3f4f6',
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
  setDefaultButtonActive: {
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    borderColor: 'rgba(245, 158, 11, 0.4)',
  },
  setDefaultButtonText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#4b5563',
  },
  setDefaultButtonTextActive: {
    color: '#d97706',
    fontWeight: '700',
  },
});

const selectStyles = {
  dropdown: {
    padding: '8px 12px',
    borderRadius: '10px',
    border: '1px solid #cbd5e1',
    backgroundColor: '#ffffff',
    color: '#0f172a',
    fontSize: '13px',
    fontWeight: '600',
    outline: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.05)',
  },
};
