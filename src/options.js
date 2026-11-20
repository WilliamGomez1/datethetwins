// Shared form options + limits. Served to the browser via GET /api/options so
// the client and server always agree.
module.exports = {
  limits: {
    minPhotosPerTwin: 2,
    maxPhotosPerTwin: 6,
    maxPhotoBytes: 10 * 1024 * 1024, // 10 MB per photo
    promptsPerTwin: 3,
    minAge: 18,
    maxAge: 99,
    maxShortText: 80,
    maxLongText: 300,
  },
  twinPrompts: [
    'The way to win me over is',
    'My twin would describe me as',
    "I'm known for",
    'My simple pleasures',
    'Green flags I look for',
    "We'll get along if",
    'The best way to ask me out is',
    'My most irrational fear',
    'Typical Sunday',
    'A shower thought I recently had',
    'I geek out on',
    "Something my twin does better than me",
    "Something I do better than my twin",
    'Unusual skills',
    'Dating me is like',
  ],
  pairPrompts: [
    'Our ideal double date',
    'Twin fact nobody believes',
    'Our twin superpower',
    'The biggest difference between us',
    'We bonded the most over',
    "You'll know it's going well when",
  ],
  twinTypes: ['Identical', 'Fraternal', 'Not sure / prefer not to say'],
};
