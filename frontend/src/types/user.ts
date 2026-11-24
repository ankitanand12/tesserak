export interface User {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
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
  organization?: string;
  mobile?: {
    countryCode: string;
    number: string;
  };
}
