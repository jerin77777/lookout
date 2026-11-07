import React from 'react';
import { Platform } from 'react-native';

interface HeaderNavigationProps {
  activeTab: 'poses' | 'animation' | 'mesh' | 'meditation';
  setActiveTab: (tab: 'poses' | 'animation' | 'mesh' | 'meditation') => void;
  headerHovered: boolean;
  setHeaderHovered: (hovered: boolean) => void;
}

export const HeaderNavigation: React.FC<HeaderNavigationProps> = ({
  activeTab,
  setActiveTab,
  headerHovered,
  setHeaderHovered,
}) => {
  if (Platform.OS !== 'web') {
    return null;
  }

  return (
    <div
      onMouseEnter={() => setHeaderHovered(true)}
      onMouseLeave={() => setHeaderHovered(false)}
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: headerHovered ? '70px' : '15px',
        backgroundColor: headerHovered ? 'rgba(10, 10, 10, 0.4)' : 'transparent',
        backdropFilter: headerHovered ? 'blur(16px)' : 'none',
        WebkitBackdropFilter: headerHovered ? 'blur(16px)' : 'none',
        borderBottom: headerHovered ? '1px solid rgba(255, 255, 255, 0.08)' : '1px solid transparent',
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        overflow: 'hidden',
      }}
    >
      {headerHovered ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            backgroundColor: 'rgba(20, 20, 20, 0.75)',
            borderRadius: '30px',
            padding: '4px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
          }}
        >
          <button
            onClick={() => setActiveTab('poses')}
            style={{
              padding: '8px 24px',
              borderRadius: '20px',
              backgroundColor: activeTab === 'poses' ? '#00ffcc' : 'transparent',
              border: 'none',
              color: activeTab === 'poses' ? '#000' : '#888',
              fontSize: '13px',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              outline: 'none',
            }}
          >
            Poses
          </button>
          <button
            onClick={() => setActiveTab('animation')}
            style={{
              padding: '8px 24px',
              borderRadius: '20px',
              backgroundColor: activeTab === 'animation' ? '#00ffcc' : 'transparent',
              border: 'none',
              color: activeTab === 'animation' ? '#000' : '#888',
              fontSize: '13px',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              outline: 'none',
            }}
          >
            Animation
          </button>
          <button
            onClick={() => setActiveTab('mesh')}
            style={{
              padding: '8px 24px',
              borderRadius: '20px',
              backgroundColor: activeTab === 'mesh' ? '#00ffcc' : 'transparent',
              border: 'none',
              color: activeTab === 'mesh' ? '#000' : '#888',
              fontSize: '13px',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              outline: 'none',
            }}
          >
            Mesh
          </button>
          <button
            onClick={() => setActiveTab('meditation')}
            style={{
              padding: '8px 24px',
              borderRadius: '20px',
              backgroundColor: activeTab === 'meditation' ? '#00ffcc' : 'transparent',
              border: 'none',
              color: activeTab === 'meditation' ? '#000' : '#888',
              fontSize: '13px',
              fontWeight: 'bold',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              outline: 'none',
            }}
          >
            Meditation
          </button>
        </div>
      ) : (
        <div
          style={{
            width: '40px',
            height: '4px',
            backgroundColor: 'rgba(0, 255, 204, 0.4)',
            borderRadius: '2px',
            marginTop: '4px',
            boxShadow: '0 0 8px rgba(0, 255, 204, 0.4)',
          }}
        />
      )}
    </div>
  );
};
