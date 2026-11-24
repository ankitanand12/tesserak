import React, { useState, useEffect, useRef } from 'react';
import {
  Box,
  Typography,
  TextField,
  Button,
  Container,
  Grid,
  MenuItem,
  InputAdornment,
  IconButton,
  Avatar,
  Chip,
  Divider,
} from '@mui/material';
import { styled } from '@mui/material/styles';
import { PhotoCamera } from '@mui/icons-material';
import { User } from '../types/user';
import { compressImage } from '../utils/imageUtils';
import Perspective3DCard from '../components/Perspective3DCard';

const Input = styled('input')({
  display: 'none',
});

interface ProfileProps {
  email: string;
}

const countryCodes = [
  { code: '+1', country: '🇺🇸 United States' },
  { code: '+44', country: '🇬🇧 United Kingdom' },
  { code: '+91', country: '🇮🇳 India' },
  { code: '+81', country: '🇯🇵 Japan' },
  { code: '+86', country: '🇨🇳 China' },
  { code: '+49', country: '🇩🇪 Germany' },
  { code: '+33', country: '🇫🇷 France' },
  { code: '+61', country: '🇦🇺 Australia' },
];

const Profile: React.FC<ProfileProps> = ({ email }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState<Partial<User>>({
    email,
    firstName: '',
    lastName: '',
    organization: '',
    avatarUrl: '',
    mobile: {
      countryCode: '+1',
      number: '',
    },
  });
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const currentUser = users.find((user: User) => user.email === email);
    if (currentUser) {
      setFormData(currentUser);
    }
  }, [email]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'countryCode' || name === 'number') {
      setFormData((prev) => ({
        ...prev,
        mobile: {
          countryCode: name === 'countryCode' ? value : prev.mobile?.countryCode || '',
          number: name === 'number' ? value : prev.mobile?.number || '',
        },
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
      }));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const users = JSON.parse(localStorage.getItem('users') || '[]');
    const updatedUsers = users.map((user: User) =>
      user.email === email ? { ...user, ...formData } : user
    );
    localStorage.setItem('users', JSON.stringify(updatedUsers));
    setIsEditing(false);
  };

  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const compressedImage = await compressImage(file);
      setFormData((prev) => ({
        ...prev,
        avatarUrl: compressedImage,
      }));

      const users: User[] = JSON.parse(localStorage.getItem('users') || '[]');
      const updatedUsers = users.map((user) =>
        user.email === email ? { ...user, avatarUrl: compressedImage } : user
      );

      try {
        localStorage.setItem('users', JSON.stringify(updatedUsers));
      } catch (storageError) {
        console.error('Failed to save to localStorage:', storageError);
        try {
          localStorage.removeItem('lastVisited');
          localStorage.removeItem('preferences');
          try {
            localStorage.setItem('users', JSON.stringify(updatedUsers));
          } catch (finalError) {
            console.error('Failed to save even after cleanup:', finalError);
            alert(
              'Warning: Your profile picture is showing but might not persist after refresh. Try a smaller image.'
            );
          }
        } catch (cleanupError) {
          console.error('Failed during storage cleanup:', cleanupError);
          alert(
            'Warning: Your profile picture is showing but might not persist after refresh. Try a smaller image.'
          );
        }
      }
    } catch (error) {
      console.error('Failed to process image:', error);
      alert('Failed to process the image. Please try a different image.');

      const users: User[] = JSON.parse(localStorage.getItem('users') || '[]');
      const currentUser = users.find((u) => u.email === email);
      setFormData((prev) => ({
        ...prev,
        avatarUrl: currentUser?.avatarUrl || prev.avatarUrl,
      }));
    }
  };

  const displayName =
    [formData.firstName, formData.lastName].filter(Boolean).join(' ') ||
    email.split('@')[0];
  const initials = `${formData.firstName?.[0] || email[0] || ''}${
    formData.lastName?.[0] || ''
  }`.toUpperCase();

  return (
    <Container maxWidth="lg" sx={{ py: 1 }}>
      <Box sx={{ mb: 4 }}>
        <Typography variant="h4">Operator Profile</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
          Manage your Tesserak identity, organization metadata, and contact preferences
        </Typography>
      </Box>

      <Grid container spacing={3.5} alignItems="flex-start">
        {/* Left 3D Operator Badge Card */}
        <Grid item xs={12} md={4}>
          <Perspective3DCard
            perspective={1100}
            baseRotateX={3}
            baseRotateY={6}
            hoverLiftZ={12}
            backingPlane
            sx={{ p: 3.5, textAlign: 'center', borderRadius: '18px' }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Box sx={{ position: 'relative', mb: 2 }}>
                <Avatar
                  src={formData.avatarUrl}
                  alt={displayName}
                  sx={{
                    width: 116,
                    height: 116,
                    fontSize: '2rem',
                    fontWeight: 700,
                    background: 'linear-gradient(135deg, #09090b 0%, #2563eb 100%)',
                    border: '4px solid #bfdbfe',
                    boxShadow: '0 14px 28px -6px rgba(37, 99, 235, 0.28)',
                  }}
                >
                  {!formData.avatarUrl && initials}
                </Avatar>
                <IconButton
                  sx={{
                    position: 'absolute',
                    bottom: 2,
                    right: -4,
                    backgroundColor: 'primary.main',
                    boxShadow: '0 6px 14px rgba(37, 99, 235, 0.35)',
                    '&:hover': { backgroundColor: 'primary.dark' },
                  }}
                  onClick={handleAvatarClick}
                >
                  <PhotoCamera sx={{ color: 'white', fontSize: 18 }} />
                </IconButton>
                <Input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleAvatarChange}
                />
              </Box>

              <Typography variant="h6" sx={{ fontWeight: 700 }}>
                {displayName}
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                {email}
              </Typography>

              <Chip
                label={formData.organization || 'Tesserak Platform Ops'}
                size="small"
                sx={{
                  bgcolor: '#eff6ff',
                  color: 'primary.main',
                  fontWeight: 600,
                  mb: 2.5,
                }}
              />

              <Divider sx={{ width: '100%', mb: 2 }} />

              <Button variant="outlined" fullWidth onClick={handleAvatarClick}>
                Update Profile Picture
              </Button>
            </Box>
          </Perspective3DCard>
        </Grid>

        {/* Right 3D User Details Panel */}
        <Grid item xs={12} md={8}>
          <Perspective3DCard
            perspective={1300}
            baseRotateX={1.5}
            baseRotateY={-2.5}
            hoverLiftZ={8}
            flattenOnFocus
            sx={{ p: 4 }}
          >
            <form onSubmit={handleSubmit}>
              <Grid container spacing={3}>
                <Grid item xs={12}>
                  <Typography variant="h6" gutterBottom>
                    User details
                  </Typography>
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    name="firstName"
                    label="First Name"
                    value={formData.firstName || ''}
                    onChange={handleInputChange}
                    fullWidth
                    required
                    disabled={!isEditing}
                  />
                </Grid>
                <Grid item xs={12} sm={6}>
                  <TextField
                    name="lastName"
                    label="Last Name"
                    value={formData.lastName || ''}
                    onChange={handleInputChange}
                    fullWidth
                    required
                    disabled={!isEditing}
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    name="email"
                    label="Email Address"
                    value={email}
                    fullWidth
                    disabled
                  />
                </Grid>
                <Grid item xs={12}>
                  <TextField
                    name="organization"
                    label="Organization"
                    value={formData.organization || ''}
                    onChange={handleInputChange}
                    fullWidth
                    disabled={!isEditing}
                  />
                </Grid>
                <Grid item xs={12} sm={4}>
                  <TextField
                    name="countryCode"
                    label="Country Code"
                    value={formData.mobile?.countryCode || '+1'}
                    onChange={handleInputChange}
                    select
                    fullWidth
                    disabled={!isEditing}
                  >
                    {countryCodes.map((option) => (
                      <MenuItem key={option.code} value={option.code}>
                        {option.country}
                      </MenuItem>
                    ))}
                  </TextField>
                </Grid>
                <Grid item xs={12} sm={8}>
                  <TextField
                    name="number"
                    label="Mobile Number"
                    value={formData.mobile?.number || ''}
                    onChange={handleInputChange}
                    fullWidth
                    disabled={!isEditing}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          {formData.mobile?.countryCode}
                        </InputAdornment>
                      ),
                    }}
                  />
                </Grid>
                <Grid item xs={12}>
                  {isEditing ? (
                    <Box sx={{ display: 'flex', gap: 2 }}>
                      <Button type="submit" variant="contained">
                        Save Changes
                      </Button>
                      <Button variant="outlined" onClick={() => setIsEditing(false)}>
                        Cancel
                      </Button>
                    </Box>
                  ) : (
                    <Button variant="contained" onClick={() => setIsEditing(true)}>
                      Edit Profile
                    </Button>
                  )}
                </Grid>
              </Grid>
            </form>
          </Perspective3DCard>
        </Grid>
      </Grid>
    </Container>
  );
};

export default Profile;
