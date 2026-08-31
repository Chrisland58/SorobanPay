import React, { useState } from 'react';
import {
    Box,
    TextField,
    Button,
    Card,
    CardContent,
    Typography,
    Alert,
    CircularProgress,
    Stack,
    Divider,
    Paper,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    FormHelperText,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import AsyncErrorBoundary from './AsyncErrorBoundary';

export const SubscriptionForm: React.FC = () => {
    const theme = useTheme();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);
    const [formData, setFormData] = useState({
        email: '',
        plan: 'basic',
        amount: '10',
        terms: false,
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccess(false);

        try {
            await new Promise((resolve, reject) => {
                setTimeout(() => {
                    if (Math.random() < 0.1) {
                        reject(new Error('Network error'));
                    } else {
                        resolve({});
                    }
                }, 1500);
            });

            setSuccess(true);
            setFormData({ email: '', plan: 'basic', amount: '10', terms: false });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong');
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (field: keyof typeof formData) => (
        e: React.ChangeEvent<HTMLInputElement | { value: unknown }>
    ) => {
        setFormData({ ...formData, [field]: e.target.value });
    };

    return (
        <AsyncErrorBoundary>
            <Box
                sx={{
                    maxWidth: 520,
                    mx: 'auto',
                    mt: 4,
                    px: { xs: 2, sm: 3 },
                    py: { xs: 2, sm: 4 },
                }}
            >
                <Paper
                    elevation={2}
                    sx={{
                        p: { xs: 3, sm: 4 },
                        borderRadius: 3,
                        backgroundColor: theme.palette.background.paper,
                        border: `1px solid ${theme.palette.divider}`,
                    }}
                >
                    <Stack spacing={3}>
                        <Box>
                            <Typography
                                variant="h4"
                                component="h1"
                                sx={{
                                    fontWeight: 700,
                                    mb: 1,
                                    fontSize: { xs: '1.75rem', sm: '2rem' },
                                }}
                            >
                                Subscribe to Plan
                            </Typography>
                            <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{ mb: 3 }}
                            >
                                Choose a plan that fits your needs
                            </Typography>
                            <Divider />
                        </Box>

                        {error && (
                            <Alert
                                severity="error"
                                sx={{
                                    borderRadius: 2,
                                    '& .MuiAlert-message': {
                                        fontSize: '0.875rem',
                                    },
                                }}
                            >
                                {error}
                            </Alert>
                        )}

                        {success && (
                            <Alert
                                severity="success"
                                sx={{
                                    borderRadius: 2,
                                    '& .MuiAlert-message': {
                                        fontSize: '0.875rem',
                                    },
                                }}
                            >
                                Subscription successful! 🎉
                            </Alert>
                        )}

                        <form onSubmit={handleSubmit}>
                            <Stack spacing={3}>
                                <TextField
                                    label="Email Address"
                                    type="email"
                                    fullWidth
                                    required
                                    value={formData.email}
                                    onChange={handleChange('email')}
                                    disabled={loading}
                                    placeholder="Enter your email"
                                    size="medium"
                                    InputProps={{
                                        sx: { borderRadius: 2 },
                                    }}
                                />

                                <FormControl fullWidth>
                                    <InputLabel>Plan</InputLabel>
                                    <Select
                                        value={formData.plan}
                                        onChange={handleChange('plan')}
                                        label="Plan"
                                        disabled={loading}
                                        sx={{ borderRadius: 2 }}
                                    >
                                        <MenuItem value="basic">Basic - $10/month</MenuItem>
                                        <MenuItem value="pro">Pro - $25/month</MenuItem>
                                        <MenuItem value="enterprise">Enterprise - $50/month</MenuItem>
                                    </Select>
                                    <FormHelperText>
                                        Choose the plan that works for you
                                    </FormHelperText>
                                </FormControl>

                                <TextField
                                    label="Amount (USD)"
                                    type="number"
                                    fullWidth
                                    required
                                    value={formData.amount}
                                    onChange={handleChange('amount')}
                                    disabled={loading}
                                    placeholder="Enter amount"
                                    size="medium"
                                    InputProps={{
                                        sx: { borderRadius: 2 },
                                    }}
                                    helperText="Minimum amount is $10"
                                />

                                <Button
                                    type="submit"
                                    variant="contained"
                                    fullWidth
                                    disabled={loading}
                                    sx={{
                                        py: 1.5,
                                        fontSize: '1rem',
                                        fontWeight: 600,
                                        borderRadius: 2,
                                        mt: 1,
                                    }}
                                    startIcon={loading ? <CircularProgress size={20} color="inherit" /> : null}
                                >
                                    {loading ? 'Processing...' : 'Subscribe Now'}
                                </Button>
                            </Stack>
                        </form>

                        <Box sx={{ mt: 2, textAlign: 'center' }}>
                            <Typography variant="caption" color="text.secondary">
                                By subscribing, you agree to our Terms of Service and Privacy Policy.
                            </Typography>
                        </Box>
                    </Stack>
                </Paper>
            </Box>
        </AsyncErrorBoundary>
    );
};
