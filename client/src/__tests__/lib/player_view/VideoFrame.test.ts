/**
 * Tests for VideoFrame.ts - SMPTE timecode and frame calculation utilities
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VideoFrame } from '@/lib/player_view/VideoFrame';

// Mock HTML video element
const createMockVideoElement = (currentTime: number = 0): HTMLVideoElement => {
  return {
    currentTime,
    paused: false,
    ended: false,
    pause: vi.fn(),
  } as any;
};

describe('VideoFrame', () => {
  let mockVideo: HTMLVideoElement;
  let videoFrame: VideoFrame;

  beforeEach(() => {
    vi.clearAllMocks();
    mockVideo = createMockVideoElement();
  });

  describe('constructor', () => {
    it('should initialize with default frame rate of 24 fps', () => {
      videoFrame = new VideoFrame({ video: mockVideo });
      expect(videoFrame.frameRate).toBe(24);
    });

    it('should initialize with custom frame rate', () => {
      videoFrame = new VideoFrame({ video: mockVideo, frameRate: 30 });
      expect(videoFrame.frameRate).toBe(30);
    });

    it('should accept video element in options', () => {
      videoFrame = new VideoFrame({ video: mockVideo });
      expect(videoFrame.video).toBe(mockVideo);
    });
  });

  describe('get() - current frame number', () => {
    beforeEach(() => {
      videoFrame = new VideoFrame({ video: mockVideo, frameRate: 24 });
    });

    it('should return 0 for time 0', () => {
      mockVideo.currentTime = 0;
      expect(videoFrame.get()).toBe(0);
    });

    it('should return correct frame number for 1 second at 24fps', () => {
      mockVideo.currentTime = 1;
      expect(videoFrame.get()).toBe(24);
    });

    it('should return correct frame number for fractional seconds', () => {
      mockVideo.currentTime = 2.5;
      expect(videoFrame.get()).toBe(60); // 2.5 * 24 = 60
    });

    it('should handle different frame rates', () => {
      videoFrame = new VideoFrame({ video: mockVideo, frameRate: 30 });
      mockVideo.currentTime = 1;
      expect(videoFrame.get()).toBe(30);
    });
  });

  describe('toTime() - convert to HH:MM:SS format', () => {
    beforeEach(() => {
      videoFrame = new VideoFrame({ video: mockVideo, frameRate: 24 });
    });

    it('should convert video current time to time format', () => {
      mockVideo.currentTime = 0;
      expect(videoFrame.toTime(0)).toBe('00:00:00:00');
    });

    it('should convert 1 hour to time format', () => {
      expect(videoFrame.toTime(3600)).toBe('01:00:00:00');
    });

    it('should convert 1 minute to time format', () => {
      expect(videoFrame.toTime(60)).toBe('00:01:00:00');
    });

    it('should convert complex time correctly', () => {
      // 1 hour, 23 minutes, 45 seconds
      expect(videoFrame.toTime(3600 + 23*60 + 45)).toBe('01:23:45:00');
    });

    it('should include frame count when frame number provided', () => {
      // Test frame format (:ff)
      const result = videoFrame.toTime(1.5); // 1.5 seconds at 24fps = 12 frames
      expect(result).toMatch(/00:00:01:\d{2}/);
    });
  });

  describe('toSMPTE() - convert to SMPTE timecode', () => {
    beforeEach(() => {
      videoFrame = new VideoFrame({ video: mockVideo, frameRate: 24 });
    });

    it('should convert current time to SMPTE when no frame provided', () => {
      mockVideo.currentTime = 0;
      const result = videoFrame.toSMPTE();
      expect(result).toMatch(/\d{2}:\d{2}:\d{2}/); // Should match HH:MM:SS format
    });

    it('should convert frame 0 to 00:00:00:00', () => {
      expect(videoFrame.toSMPTE(0)).toBe('00:00:00:00');
    });

    it('should convert frame 24 to 00:00:01:00 at 24fps', () => {
      expect(videoFrame.toSMPTE(24)).toBe('00:00:01:00');
    });

    it('should convert frame 25 to 00:00:01:01 at 24fps', () => {
      expect(videoFrame.toSMPTE(25)).toBe('00:00:01:01');
    });

    it('should convert 1 hour worth of frames', () => {
      // 1 hour = 3600 seconds * 24 fps = 86400 frames
      expect(videoFrame.toSMPTE(86400)).toBe('01:00:00:00');
    });

    it('should convert complex frame numbers correctly', () => {
      // 1 hour, 23 minutes, 45 seconds, 12 frames
      const frames = (1 * 3600 + 23 * 60 + 45) * 24 + 12;
      expect(videoFrame.toSMPTE(frames)).toBe('01:23:45:12');
    });

    it('should handle different frame rates', () => {
      videoFrame = new VideoFrame({ video: mockVideo, frameRate: 30 });
      // 1 second at 30fps
      expect(videoFrame.toSMPTE(30)).toBe('00:00:01:00');
    });
  });

  describe('toSeconds() - convert SMPTE to seconds', () => {
    beforeEach(() => {
      videoFrame = new VideoFrame({ video: mockVideo, frameRate: 24 });
    });

    it('should convert 00:00:00:00 to 0 seconds', () => {
      expect(videoFrame.toSeconds('00:00:00:00')).toBe(0);
    });

    it('should convert 00:01:00:00 to 60 seconds', () => {
      expect(videoFrame.toSeconds('00:01:00:00')).toBe(60);
    });

    it('should convert 01:00:00:00 to 3600 seconds', () => {
      expect(videoFrame.toSeconds('01:00:00:00')).toBe(3600);
    });

    it('should convert complex SMPTE correctly', () => {
      // 01:23:45:12 should be 1*3600 + 23*60 + 45 = 5025 seconds
      expect(videoFrame.toSeconds('01:23:45:12')).toBe(5025);
    });

    it('should return current video time when no SMPTE provided', () => {
      mockVideo.currentTime = 42.5;
      expect(videoFrame.toSeconds('')).toBe(42); // Math.floor
    });
  });

  describe('toMilliseconds() - convert SMPTE to milliseconds', () => {
    beforeEach(() => {
      videoFrame = new VideoFrame({ video: mockVideo, frameRate: 24 });
    });

    it('should convert 00:00:00:00 to 0 milliseconds', () => {
      expect(videoFrame.toMilliseconds('00:00:00:00')).toBe(0);
    });

    it('should convert 00:00:01:00 to 1000 milliseconds', () => {
      expect(videoFrame.toMilliseconds('00:00:01:00')).toBe(1000);
    });

    it('should include frame milliseconds in calculation', () => {
      // 00:00:00:12 at 24fps = 12 frames = 12 * (1000/24) = 500ms
      expect(videoFrame.toMilliseconds('00:00:00:12')).toBe(500);
    });

    it('should convert complex SMPTE with frames', () => {
      // 00:00:02:06 = 2 seconds + 6 frames
      // 6 frames at 24fps = 6 * (1000/24) = 250ms
      // Total: 2000 + 250 = 2250ms
      expect(videoFrame.toMilliseconds('00:00:02:06')).toBe(2250);
    });

    it('should handle current video SMPTE when no parameter provided', () => {
      mockVideo.currentTime = 1.5; // Should have some frames
      const result = videoFrame.toMilliseconds('');
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe('toFrames() - convert SMPTE to frame number', () => {
    beforeEach(() => {
      videoFrame = new VideoFrame({ video: mockVideo, frameRate: 24 });
    });

    it('should convert 00:00:00:00 to frame 0', () => {
      expect(videoFrame.toFrames('00:00:00:00')).toBe(0);
    });

    it('should convert 00:00:01:00 to frame 24 at 24fps', () => {
      expect(videoFrame.toFrames('00:00:01:00')).toBe(24);
    });

    it('should convert 00:00:00:12 to frame 12', () => {
      expect(videoFrame.toFrames('00:00:00:12')).toBe(12);
    });

    it('should convert 00:01:00:00 to frame 1440 at 24fps', () => {
      // 1 minute = 60 seconds * 24 fps = 1440 frames
      expect(videoFrame.toFrames('00:01:00:00')).toBe(1440);
    });

    it('should convert complex SMPTE correctly', () => {
      // 01:23:45:12 at 24fps
      const expectedFrames = (1 * 3600 + 23 * 60 + 45) * 24 + 12;
      expect(videoFrame.toFrames('01:23:45:12')).toBe(expectedFrames);
    });

    it('should handle different frame rates', () => {
      videoFrame = new VideoFrame({ video: mockVideo, frameRate: 30 });
      // 00:00:01:00 at 30fps = 30 frames
      expect(videoFrame.toFrames('00:00:01:00')).toBe(30);
    });

    it('should use current video SMPTE when no parameter provided', () => {
      mockVideo.currentTime = 1; // 1 second at 24fps = 24 frames
      const result = videoFrame.toFrames('');
      expect(result).toBeGreaterThanOrEqual(0);
    });
  });

  describe('seeking methods', () => {
    beforeEach(() => {
      videoFrame = new VideoFrame({ video: mockVideo, frameRate: 24 });
      mockVideo.currentTime = 2; // Start at 2 seconds (frame 48)
    });

    describe('seekForward()', () => {
      it('should seek forward 1 frame by default', () => {
        videoFrame.seekForward(0, null);
        // Current frame is 48, seeking forward 1 should set currentTime to 49/24 + 0.00001
        expect(mockVideo.currentTime).toBeCloseTo((49 / 24) + 0.00001, 4);
      });

      it('should seek forward specified number of frames', () => {
        videoFrame.seekForward(5, null);
        // Frame 48 + 5 = 53, so 53/24 + 0.00001
        expect(mockVideo.currentTime).toBeCloseTo((53 / 24) + 0.00001, 4);
      });

      it('should pause video before seeking', () => {
        // Simulate video playing state by mocking the getter
        Object.defineProperty(mockVideo, 'paused', { value: false, configurable: true });
        videoFrame.seekForward(1, null);
        expect(mockVideo.pause).toHaveBeenCalled();
      });

      it('should execute callback if provided', () => {
        const callback = vi.fn();
        videoFrame.seekForward(1, callback);
        expect(callback).toHaveBeenCalled();
      });

      it('should return true when no callback provided', () => {
        const result = videoFrame.seekForward(1, null);
        expect(result).toBe(true);
      });
    });

    describe('seekBackward()', () => {
      it('should seek backward 1 frame by default', () => {
        videoFrame.seekBackward(0, null);
        // Current frame is 48, seeking backward 1 should set currentTime to 47/24 + 0.00001
        expect(mockVideo.currentTime).toBeCloseTo((47 / 24) + 0.00001, 4);
      });

      it('should seek backward specified number of frames', () => {
        videoFrame.seekBackward(5, null);
        // Frame 48 - 5 = 43, so 43/24 + 0.00001
        expect(mockVideo.currentTime).toBeCloseTo((43 / 24) + 0.00001, 4);
      });

      it('should pause video before seeking', () => {
        // Simulate video playing state by mocking the getter
        Object.defineProperty(mockVideo, 'paused', { value: false, configurable: true });
        videoFrame.seekBackward(1, null);
        expect(mockVideo.pause).toHaveBeenCalled();
      });

      it('should execute callback if provided', () => {
        const callback = vi.fn();
        videoFrame.seekBackward(1, callback);
        expect(callback).toHaveBeenCalled();
      });
    });

    describe('seekToFrame()', () => {
      it('should seek to specific frame', () => {
        videoFrame.seekToFrame(100);
        // Should convert frame 100 to SMPTE, then to milliseconds, then set currentTime
        // Frame 100 at 24fps = 00:00:04:04 = 4 seconds + 4/24 seconds + some offset
        expect(mockVideo.currentTime).toBeGreaterThan(4);
      });
    });

    describe('seekToSMPTE()', () => {
      it('should seek to specific SMPTE timecode', () => {
        videoFrame.seekToSMPTE('00:00:05:00');
        // Should convert to milliseconds and set currentTime
        // 5 seconds = 5000ms = 5 seconds + 0.001 offset
        expect(mockVideo.currentTime).toBeCloseTo(5.001, 2);
      });

      it('should handle SMPTE with frames', () => {
        videoFrame.seekToSMPTE('00:00:02:12');
        // 2 seconds + 12 frames at 24fps
        // 12 frames = 12 * (1000/24) = 500ms
        // Total: 2000 + 500 = 2500ms = 2.5 seconds + 0.001
        expect(mockVideo.currentTime).toBeCloseTo(2.501, 2);
      });
    });
  });

  describe('edge cases and error handling', () => {
    beforeEach(() => {
      videoFrame = new VideoFrame({ video: mockVideo, frameRate: 24 });
    });

    it('should handle zero frame rate gracefully', () => {
      videoFrame = new VideoFrame({ video: mockVideo, frameRate: 0 });
      mockVideo.currentTime = 1;
      // Should not throw, but result may be Infinity or NaN
      expect(() => videoFrame.get()).not.toThrow();
    });

    it('should handle negative current time', () => {
      mockVideo.currentTime = -1;
      const result = videoFrame.get();
      expect(result).toBeLessThan(0);
    });

    it('should handle invalid SMPTE format', () => {
      expect(() => videoFrame.toSeconds('invalid')).not.toThrow();
      expect(() => videoFrame.toMilliseconds('invalid')).not.toThrow();
      expect(() => videoFrame.toFrames('invalid')).not.toThrow();
    });

    it('should handle empty SMPTE strings', () => {
      expect(videoFrame.toSeconds('')).toBe(Math.floor(mockVideo.currentTime));
      expect(() => videoFrame.toMilliseconds('')).not.toThrow();
      expect(() => videoFrame.toFrames('')).not.toThrow();
    });

    it('should handle very large frame numbers', () => {
      const largeFrame = 999999;
      const result = videoFrame.toSMPTE(largeFrame);
      expect(result).toMatch(/\d{2}:\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('conversion consistency', () => {
    beforeEach(() => {
      videoFrame = new VideoFrame({ video: mockVideo, frameRate: 24 });
    });

    it('should maintain consistency: frame -> SMPTE -> frame', () => {
      const originalFrame = 1000;
      const smpte = videoFrame.toSMPTE(originalFrame);
      const convertedFrame = videoFrame.toFrames(smpte);
      expect(convertedFrame).toBe(originalFrame);
    });

    it('should maintain consistency: SMPTE -> seconds -> SMPTE conversion', () => {
      const originalSMPTE = '01:23:45:12';
      const seconds = videoFrame.toSeconds(originalSMPTE);
      // Note: We lose frame precision when converting to seconds
      expect(seconds).toBe(5025); // 1*3600 + 23*60 + 45
    });

    it('should maintain millisecond precision', () => {
      const smpte = '00:00:02:06'; // 2 seconds + 6 frames
      const ms = videoFrame.toMilliseconds(smpte);
      const expectedMs = 2000 + (6 * (1000/24)); // 2000 + 250 = 2250
      expect(ms).toBe(Math.floor(expectedMs));
    });
  });

  describe('different frame rates', () => {
    const testFrameRates = [24, 25, 30, 50, 60]; // Only test integer frame rates

    testFrameRates.forEach(frameRate => {
      it(`should handle ${frameRate} fps correctly`, () => {
        videoFrame = new VideoFrame({ video: mockVideo, frameRate });
        
        // Test basic conversion
        mockVideo.currentTime = 1;
        const currentFrame = videoFrame.get();
        expect(currentFrame).toBe(Math.floor(frameRate));
        
        // Test SMPTE conversion - exactly frameRate frames should equal 1 second
        const smpte = videoFrame.toSMPTE(frameRate);
        expect(smpte).toBe('00:00:01:00');
      });
    });

    // Test fractional frame rates separately
    it('should handle fractional frame rates (23.976 fps)', () => {
      videoFrame = new VideoFrame({ video: mockVideo, frameRate: 23.976 });
      mockVideo.currentTime = 1;
      const currentFrame = videoFrame.get();
      expect(currentFrame).toBe(23); // Math.floor(23.976)
    });

    it('should handle fractional frame rates (29.97 fps)', () => {
      videoFrame = new VideoFrame({ video: mockVideo, frameRate: 29.97 });
      mockVideo.currentTime = 1;
      const currentFrame = videoFrame.get();
      expect(currentFrame).toBe(29); // Math.floor(29.97)
    });
  });
});