import React from 'react';
import { Platform, StyleSheet, View, TextInput, Pressable, ActivityIndicator } from 'react-native';
import { SymbolView } from 'expo-symbols';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';

interface AnimationSidebarProps {
  jsonText: string;
  setJsonText: (text: string) => void;
  promptText: string;
  setPromptText: (text: string) => void;
}

export const AnimationSidebar: React.FC<AnimationSidebarProps> = ({
  jsonText,
  setJsonText,
  promptText,
  setPromptText,
}) => {
  const [isLoading, setIsLoading] = React.useState(false);

  return (
    <View style={[styles.poseSidebar, { width: 380, gap: 16 }]}>
      <View style={styles.editorContainer}>
        <ThemedText style={styles.editorLabelAbsolute}>Logs</ThemedText>
        <textarea
          value={jsonText}
          onChange={(e) => {
            const text = e.target.value;
            setJsonText(text);
            if (Platform.OS === 'web' && typeof window !== 'undefined' && window.localStorage) {
              window.localStorage.setItem('vyom_animation_sequence', text);
            }
          }}
          placeholder=""
          style={{
            width: '100%',
            height: 428,
            boxSizing: 'border-box',
            backgroundColor: '#ffffff',
            color: '#333333',
            border: '1px solid #e0e0e0',
            borderRadius: 16,
            paddingTop: 36,
            paddingBottom: 16,
            paddingLeft: 16,
            paddingRight: 16,
            fontFamily: 'monospace',
            fontSize: 13,
            outlineStyle: 'none' as any,
            resize: 'none',
            lineHeight: 1.6,
          }}
        />
      </View>
      
      {/* Mock Chat Message Box */}
      <View style={styles.chatInputContainer}>
        <TextInput
          value={promptText}
          onChangeText={setPromptText}
          placeholder="Ask AI to generate a sequence..."
          placeholderTextColor="#888"
          multiline
          numberOfLines={3}
          style={styles.chatInput}
        />
        <Pressable
          onPress={() => {
            if (isLoading) return;
            setPromptText('');
            setIsLoading(true);
            setTimeout(() => {
              setIsLoading(false);
            }, 1000);
          }}
          style={({ pressed }) => [
            styles.generateButton,
            (pressed || isLoading) && { opacity: 0.8 }
          ]}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator size="small" color="#ffffff" />
          ) : (
            <SymbolView
              tintColor="#ffffff"
              name={{ ios: 'sparkles', android: 'auto_awesome', web: 'auto_awesome' }}
              size={16}
            />
          )}
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  poseSidebar: {
    width: Platform.OS === 'web' ? 280 : '100%',
    paddingVertical: Spacing.four,
    paddingRight: Spacing.two,
    paddingLeft: 0,
    gap: Spacing.two,
  },
  editorContainer: {
    position: 'relative',
    flex: 1,
    width: '100%',
  },
  editorLabelAbsolute: {
    position: 'absolute',
    left: 16,
    top: 12,
    color: '#888888',
    fontSize: 13,
    zIndex: 2,
    pointerEvents: 'none',
  },
  chatInputContainer: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
  },
  chatInput: {
    flex: 1,
    backgroundColor: '#ffffff',
    color: '#000000',
    borderRadius: 16,
    paddingTop: 12,
    paddingBottom: 44, // Add bottom padding so text doesn't overlap the button
    paddingLeft: 16,
    paddingRight: 46,
    fontSize: 13,
    borderColor: '#e0e0e0',
    borderWidth: 1,
    minHeight: 80,
    textAlignVertical: 'top',
    ...Platform.select({
      web: {
        outlineStyle: 'none' as any,
      }
    })
  },
  generateButton: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    backgroundColor: '#00ffcc',
    width: 32,
    height: 32,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
