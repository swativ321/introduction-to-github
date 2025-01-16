import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand, GetCommand } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({ region: "us-east-1" });
const docClient = DynamoDBDocumentClient.from(ddbClient);

export const handler = async (event) => {
    try {
        console.log('Received event:', JSON.stringify(event, null, 2));

        if (event.httpMethod === 'OPTIONS') {
            return createResponse(200, {});
        }

        // Parse payment data
        const paymentData = event;
        console.log('Processing payment data:', JSON.stringify(paymentData, null, 2));

        // Validate payment data
        const validation = validatePaymentData(paymentData);
        if (!validation.valid) {
            console.log('Validation failed:', validation.error);
            return createResponse(400, { 
                success: false, 
                error: validation.error 
            });
        }

        // Process payment
        const paymentResult = await processPayment(paymentData);
        console.log('Payment result:', paymentResult);

        if (!paymentResult.success) {
            return createResponse(400, { 
                success: false, 
                error: paymentResult.error 
            });
        }

        // Generate booking reference
        const bookingRef = generateBookingReference();
        console.log('Generated booking reference:', bookingRef);

        try {
            // Save booking details
            await saveBooking({
                bookingRef,
                paymentId: paymentResult.paymentId,
                ...paymentData.bookingData,
                status: 'CONFIRMED',
                timestamp: new Date().toISOString()
            });

            // Return success response
            return createResponse(200, {
                success: true,
                bookingReference: bookingRef,
                paymentId: paymentResult.paymentId
            });
        } catch (saveError) {
            console.error('Error saving booking:', saveError);
            return createResponse(500, {
                success: false,
                error: 'Failed to save booking details'
            });
        }
    } catch (error) {
        console.error('Error in handler:', error);
        return createResponse(500, {
            success: false,
            error: 'Internal server error',
            message: error.message
        });
    }
};


function isValidCVV(cvv) {
    // CVV should be 3 or 4 digits
    return /^\d{3,4}$/.test(cvv);
}

function isValidCardNumber(cardNumber) {
    // Remove spaces and dashes
    cardNumber = cardNumber.replace(/[\s-]/g, '');
    
    // Check if number is between 13 and 19 digits
    if (!/^\d{16}$/.test(cardNumber)) return false;

    // Luhn algorithm implementation
    let sum = 0;
    let isEven = false;

    for (let i = cardNumber.length - 1; i >= 0; i--) {
        let digit = parseInt(cardNumber[i]);

        if (isEven) {
            digit *= 2;
            if (digit > 9) {
                digit -= 9;
            }
        }

        sum += digit;
        isEven = !isEven;
    }

    return sum % 10 === 0;
}

function isValidExpiryDate(expiryDate) {
    const [monthStr, yearStr] = expiryDate.split('/');
    const month = parseInt(monthStr);
    const year = 2000 + parseInt(yearStr);

    if (isNaN(month) || isNaN(year)) return false;
    if (month < 1 || month > 12) return false;

    const now = new Date();
    const expiry = new Date(year, month - 1);
    
    return expiry > now;
}

// Update the validatePaymentData function to use these validators
function validatePaymentData(paymentData) {
    const { cardNumber, expiryDate, cvv, cardName, billingAddress, bookingData } = paymentData;

    // Validate card number
    if (!cardNumber || !isValidCardNumber(cardNumber)) {
        return {
            valid: false,
            error: 'Invalid card number'
        };
    }

    // Validate expiry date
    if (!expiryDate || !isValidExpiryDate(expiryDate)) {
        return {
            valid: false,
            error: 'Invalid or expired card'
        };
    }

    // Validate CVV
    if (!cvv || !isValidCVV(cvv)) {
        return {
            valid: false,
            error: 'Invalid CVV'
        };
    }

    // Validate cardholder name
    if (!cardName || cardName.length < 2) {
        return {
            valid: false,
            error: 'Invalid cardholder name'
        };
    }

    // Validate billing address
    if (!billingAddress || billingAddress.length < 5) {
        return {
            valid: false,
            error: 'Invalid billing address'
        };
    }

    // Validate booking data exists
    if (!bookingData || !bookingData.flights || !bookingData.seats || !bookingData.passengers) {
        return {
            valid: false,
            error: 'Missing booking information'
        };
    }

    // Validate total price
    if (typeof bookingData.totalPrice !== 'number' || bookingData.totalPrice <= 0) {
        return {
            valid: false,
            error: 'Invalid booking price'
        };
    }

    return { valid: true };
}




// Update the processPayment mock implementation
async function processPayment(paymentData) {
    console.log('Processing payment with data:', JSON.stringify(paymentData, null, 2));

    // Validate expiry date first
    if (!isValidExpiryDate(paymentData.expiryDate)) {
        return {
            success: false,
            error: 'Card has expired'
        };
    }

    // This would typically integrate with a payment gateway
    // Mock implementation for testing
    const shouldSucceed = Math.random() > 0.1; // 90% success rate

    if (shouldSucceed) {
        return {
            success: true,
            paymentId: `PAY-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
        };
    } else {
        return {
            success: false,
            error: 'Payment declined. Please try a different card.'
        };
    }
}





function generateBookingReference() {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const length = 6;
    let result = '';
    for (let i = 0; i < length; i++) {
        result += charset.charAt(Math.floor(Math.random() * charset.length));
    }
    return result;
}

async function saveBooking(bookingData) {
    const params = {
        TableName: 'Bookings',
        Item: bookingData,
        ConditionExpression: 'attribute_not_exists(bookingRef)'
    };

    try {
        await docClient.send(new PutCommand(params));
    } catch (error) {
        console.error('Error saving booking:', error);
        throw new Error('Failed to save booking');
    }
}

function createResponse(statusCode, body) {
    console.log('Creating response:', { statusCode, body }); // Add logging
    
    const response = {
        statusCode,
        headers: {
            'Access-Control-Allow-Origin': 'http://my-ssoffice-bucket.s3-website-us-east-1.amazonaws.com',
            'Access-Control-Allow-Credentials': true,
            'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
            'Access-Control-Allow-Methods': 'OPTIONS,POST',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    };

    console.log('Final response:', response); // Add logging
    return response;
}