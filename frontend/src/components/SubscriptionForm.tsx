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
} from '@mui/material';
import AsyncErrorBoundary from './AsyncErrorBoundary';

export const SubscriptionForm: React.FC = () => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const [formData, setFormData] = useState({
        email: '',
        plan: 'basic',
        amount: '10',
    });

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError(null);
        setSuccess(false);

        try {
            // Simulate API call
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
            setFormData({ email: '', plan: 'basic', amount: '10' });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Something went wrong');
        } finally {
            setLoading(false);
        }
    };

    const handleChange = (field: keyof typeof formData) => (
        e: React.ChangeEvent<HTMLInputElement>
    ) => {
        setFormData({ ...formData, [field]: e.target.value });
    };

    return (
        <AsyncErrorBoundary>
            <Box sx={{ maxWidth: 500, mx: 'auto', mt: 4 }}>
                <Card>
                    <CardContent>
                        <Typography variant="h5" gutterBottom>
                            Subscribe to Plan
                        </Typography>

                        {error && (
                            <Alert severity="error" sx={{ mb: 2 }}>
                                {error}
                            </Alert>
                        )}

                        {success && (
                            <Alert severity="success" sx={{ mb: 2 }}>
                                Subscription successful! 🎉
                            </Alert>
                        )}

                        <form onSubmit={handleSubmit}>
                            <TextField
                                label="Email"
                                type="email"
                                fullWidth
                                required
                                value={formData.email}
                                onChange={handleChange('email')}
                                sx={{ mb: 2 }}
                                disabled={loading}
                            />

                            <TextField
                                label="Plan"
                                fullWidth
                                required
                                value={formData.plan}
                                onChange={handleChange('plan')}
                                sx={{ mb: 2 }}
                                disabled={loading}
                            />

                            <TextField
                                label="Amount (USD)"
                                type="number"
                                fullWidth
                                required
                                value={formData.amount}
                                onChange={handleChange('amount')}
                                sx={{ mb: 2 }}
                                disabled={loading}
                            />

                            <Button
                                type="submit"
                                variant="contained"
                                fullWidth
                                disabled={loading}
                                startIcon={loading ? <CircularProgress size={20} /> : null}
                            >
                                {loading ? 'Processing...' : 'Subscribe'}
                            </Button>
                        </form>
                    </CardContent>
                </Card>
            </Box>
        </AsyncErrorBoundary>
    );
};
