export type AccountType = 'individual' | 'organization';

export interface User {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  accountType?: AccountType;
  organization?: string;
  avatarUrl?: string;
  mobile?: {
    countryCode: string;
    number: string;
  };
}

export interface UserProfile {
  email: string;
  firstName: string;
  lastName: string;
  accountType?: AccountType;
  organization?: string;
  mobile?: {
    countryCode: string;
    number: string;
  };
}
