import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

const ddbClient = new DynamoDBClient({ region: "us-east-1" });
const docClient = DynamoDBDocumentClient.from(ddbClient);

export const handler = async (event) => {
    try {
        // Add logging to debug
        console.log('Received event:', JSON.stringify(event));
        
        // Get the data either from event.body or event directly
        let requestData;
        if (event.body) {
            requestData = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        } else {
            requestData = event;
        }
            
        console.log('Request data:', requestData);
        
        const { passengers } = requestData;
        
        // Validate basic input
        if (!Array.isArray(passengers) || passengers.length === 0 || passengers.length > 9) {
            return createResponse(400, { 
                error: 'Invalid number of passengers. Must be between 1 and 9.' 
            });
        }
        
        const validation = validatePassengers(passengers);
        if (!validation.valid) {
            return createResponse(400, { error: validation.error });
        }
        
        return createResponse(200, {
            success: true,
            passengerTypes: validation.passengerTypes
        });
    } catch (error) {
        console.error('Error:', error);
        return createResponse(500, { 
            error: 'Internal server error',
            details: error.message 
        });
    }
};

function validatePassengers(passengers) {
    const passengerTypes = {
        adults: 0,
        children: 0,
        infants: 0
    };
    
    const nameRegex = /^[A-Za-z\s-]{2,50}$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    for (const passenger of passengers) {
        // Validate names
        if (!nameRegex.test(passenger.firstName) || !nameRegex.test(passenger.lastName)) {
            return {
                valid: false,
                error: 'Invalid name format. Names must be 2-50 characters long and contain only letters, spaces, and hyphens.'
            };
        }
        
        // Validate email
        if (!emailRegex.test(passenger.email)) {
            return {
                valid: false,
                error: 'Invalid email format.'
            };
        }
        
        // Validate date of birth and categorize passenger
        const age = calculateAge(passenger.dateOfBirth);
        
        if (age < 0) {
            return {
                valid: false,
                error: 'Invalid date of birth.'
            };
        }
        
        if (age >= 12) {
            passengerTypes.adults++;
        } else if (age >= 2) {
            passengerTypes.children++;
        } else {
            passengerTypes.infants++;
        }
    }
    
    // Validate passenger type ratios
    if (passengerTypes.adults === 0) {
        return {
            valid: false,
            error: 'At least one adult passenger is required.'
        };
    }
    
    if (passengerTypes.infants > passengerTypes.adults) {
        return {
            valid: false,
            error: 'Maximum one infant per adult allowed.'
        };
    }
    
    return {
        valid: true,
        passengerTypes
    };
}

function calculateAge(dateOfBirth) {
    const today = new Date();
    const birthDate = new Date(dateOfBirth);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
    }
    
    return age;
}

function createResponse(statusCode, body) {
    return {
        statusCode,
        headers: {
            'Access-Control-Allow-Origin': '*',
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    };
}