import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { ThemeToggle } from './components/ThemeToggle';
import ErrorBoundary from './components/ErrorBoundary';
import { SubscriptionForm } from './components/SubscriptionForm';
import { TransactionBuilder } from './lib/transaction_builder';
import { Box, AppBar, Toolbar, Typography, Container } from '@mui/material';

function App() {
    return (
        <ThemeProvider>
            <ErrorBoundary>
                <BrowserRouter>
                    <AppBar position="static" color="default" elevation={1}>
                        <Toolbar>
                            <Typography variant="h6" sx={{ flexGrow: 1, fontWeight: 700 }}>
                                SorobanPay
                            </Typography>
                            <ThemeToggle />
                        </Toolbar>
                    </AppBar>
                    <Container maxWidth="lg">
                        <Routes>
                            <Route path="/" element={<SubscriptionForm />} />
                            <Route path="/subscribe" element={<SubscriptionForm />} />
                            <Route path="/transactions" element={<TransactionBuilder />} />
                        </Routes>
                    </Container>
                </BrowserRouter>
            </ErrorBoundary>
        </ThemeProvider>
    );
}

export default App;
